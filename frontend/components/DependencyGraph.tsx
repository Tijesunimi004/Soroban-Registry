'use client';

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import * as d3 from 'd3';
import { GraphNode, GraphEdge } from '@/lib/api';

interface SimNode extends d3.SimulationNodeDatum {
    id: string;
    contract_id: string;
    name: string;
    network: 'Mainnet' | 'Testnet' | 'Futurenet';
    is_verified: boolean;
    category?: string;
    tags: string[];
    radius: number;
    isCritical: boolean;
    isSearchMatch: boolean;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
    dependency_type: string;
}

interface DependencyGraphProps {
    nodes: GraphNode[];
    edges: GraphEdge[];
    searchQuery: string;
    dependentCounts: Map<string, number>;
    onNodeClick: (node: GraphNode | null) => void;
    selectedNode: GraphNode | null;
}

export interface DependencyGraphHandle {
    zoomIn: () => void;
    zoomOut: () => void;
    resetZoom: () => void;
    exportSVG: () => void;
    exportPNG: () => void;
    focusOnNode: (nodeId: string) => void;
    getSearchMatches: () => string[];
}

const NETWORK_COLORS: Record<string, string> = {
    Mainnet: '#22c55e',
    Testnet: '#3b82f6',
    Futurenet: '#a855f7',
};

const NETWORK_COLORS_DIM: Record<string, string> = {
    Mainnet: '#166534',
    Testnet: '#1e3a5f',
    Futurenet: '#581c87',
};

const DependencyGraph = forwardRef<DependencyGraphHandle, DependencyGraphProps>(
    ({ nodes, edges, searchQuery, dependentCounts, onNodeClick, selectedNode }, ref) => {
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const containerRef = useRef<HTMLDivElement>(null);
        const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
        const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
        const zoomBehaviorRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
        const animFrameRef = useRef<number>(0);
        const simNodesRef = useRef<SimNode[]>([]);
        const simLinksRef = useRef<SimLink[]>([]);
        const hoveredNodeRef = useRef<SimNode | null>(null);
        const pulseRef = useRef(0);

        // Export SVG (re-renders the current state as an SVG)
        const exportSVG = useCallback(() => {
            const simNodes = simNodesRef.current;
            const simLinks = simLinksRef.current;
            if (simNodes.length === 0) return;

            const padding = 60;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const n of simNodes) {
                const x = n.x ?? 0;
                const y = n.y ?? 0;
                const r = n.radius;
                if (x - r < minX) minX = x - r;
                if (y - r < minY) minY = y - r;
                if (x + r > maxX) maxX = x + r;
                if (y + r > maxY) maxY = y + r;
            }
            const width = maxX - minX + padding * 2;
            const height = maxY - minY + padding * 2;
            const offsetX = -minX + padding;
            const offsetY = -minY + padding;

            const svgParts: string[] = [];
            svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
            svgParts.push(`<rect width="100%" height="100%" fill="#030712"/>`);

            // Defs for arrowheads
            svgParts.push(`<defs>`);
            svgParts.push(`<marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#4b5563"/></marker>`);
            svgParts.push(`</defs>`);

            // Edges
            for (const link of simLinks) {
                const s = link.source as SimNode;
                const t = link.target as SimNode;
                const sx = (s.x ?? 0) + offsetX;
                const sy = (s.y ?? 0) + offsetY;
                const tx = (t.x ?? 0) + offsetX;
                const ty = (t.y ?? 0) + offsetY;
                svgParts.push(`<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="#374151" stroke-width="1" marker-end="url(#arrow)" opacity="0.6"/>`);
            }

            // Nodes
            for (const node of simNodes) {
                const cx = (node.x ?? 0) + offsetX;
                const cy = (node.y ?? 0) + offsetY;
                const color = NETWORK_COLORS[node.network] || '#6b7280';
                svgParts.push(`<circle cx="${cx}" cy="${cy}" r="${node.radius}" fill="${color}" opacity="0.9"/>`);
                if (node.isCritical) {
                    svgParts.push(`<circle cx="${cx}" cy="${cy}" r="${node.radius + 4}" fill="none" stroke="#fbbf24" stroke-width="2" opacity="0.7"/>`);
                }
                if (node.radius >= 6) {
                    svgParts.push(`<text x="${cx}" y="${cy + node.radius + 12}" text-anchor="middle" fill="#9ca3af" font-size="10" font-family="Inter, sans-serif">${escapeXml(node.name)}</text>`);
                }
            }

            svgParts.push(`</svg>`);

            const blob = new Blob([svgParts.join('\n')], { type: 'image/svg+xml' });
            downloadBlob(blob, 'dependency-graph.svg');
        }, []);

        // Export PNG
        const exportPNG = useCallback(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            // Re-render at current state without transform for a clean export
            const simNodes = simNodesRef.current;
            const simLinks = simLinksRef.current;
            if (simNodes.length === 0) return;

            const padding = 60;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const n of simNodes) {
                const x = n.x ?? 0;
                const y = n.y ?? 0;
                const r = n.radius;
                if (x - r < minX) minX = x - r;
                if (y - r < minY) minY = y - r;
                if (x + r > maxX) maxX = x + r;
                if (y + r > maxY) maxY = y + r;
            }
            const width = maxX - minX + padding * 2;
            const height = maxY - minY + padding * 2;

            const exportCanvas = document.createElement('canvas');
            const ratio = 2;
            exportCanvas.width = width * ratio;
            exportCanvas.height = height * ratio;
            const ctx = exportCanvas.getContext('2d')!;
            ctx.scale(ratio, ratio);
            ctx.fillStyle = '#030712';
            ctx.fillRect(0, 0, width, height);
            ctx.translate(-minX + padding, -minY + padding);

            drawGraph(ctx, simNodes, simLinks, '', null, 0);

            exportCanvas.toBlob((blob) => {
                if (blob) downloadBlob(blob, 'dependency-graph.png');
            }, 'image/png');
        }, []);

        useImperativeHandle(ref, () => ({
            zoomIn: () => {
                const canvas = canvasRef.current;
                const zb = zoomBehaviorRef.current;
                if (canvas && zb) {
                    d3.select(canvas).transition().duration(300).call(zb.scaleBy, 1.5);
                }
            },
            zoomOut: () => {
                const canvas = canvasRef.current;
                const zb = zoomBehaviorRef.current;
                if (canvas && zb) {
                    d3.select(canvas).transition().duration(300).call(zb.scaleBy, 0.67);
                }
            },
            resetZoom: () => {
                const canvas = canvasRef.current;
                const zb = zoomBehaviorRef.current;
                if (canvas && zb) {
                    const centered = d3.zoomIdentity.translate(canvas.clientWidth / 2, canvas.clientHeight / 2);
                    d3.select(canvas).transition().duration(500).call(zb.transform, centered);
                }
            },
            focusOnNode: (nodeId: string) => {
                const canvas = canvasRef.current;
                const zb = zoomBehaviorRef.current;
                if (!canvas || !zb) return;
                const node = simNodesRef.current.find((n) => n.id === nodeId);
                if (!node || node.x == null || node.y == null) return;
                const scale = 2;
                const tx = canvas.clientWidth / 2 - node.x * scale;
                const ty = canvas.clientHeight / 2 - node.y * scale;
                const t = d3.zoomIdentity.translate(tx, ty).scale(scale);
                d3.select(canvas).transition().duration(600).call(zb.transform, t);
            },
            getSearchMatches: () => {
                return simNodesRef.current
                    .filter((n) => n.isSearchMatch)
                    .map((n) => n.id);
            },
            exportSVG,
            exportPNG,
        }), [exportSVG, exportPNG]);

        // Initialize simulation
        useEffect(() => {
            if (nodes.length === 0) {
                simNodesRef.current = [];
                simLinksRef.current = [];
                if (simulationRef.current) simulationRef.current.stop();
                return;
            }

            const query = searchQuery.toLowerCase();

            const simNodes: SimNode[] = nodes.map((n) => {
                const depCount = dependentCounts.get(n.id) || 0;
                const radius = Math.max(4, Math.min(20, 4 + depCount * 2));
                return {
                    ...n,
                    radius,
                    isCritical: depCount >= 5,
                    isSearchMatch: query ? n.name.toLowerCase().includes(query) || n.contract_id.toLowerCase().includes(query) : false,
                };
            });

            const nodeMap = new Map(simNodes.map((n) => [n.id, n]));

            const simLinks: SimLink[] = edges
                .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
                .map((e) => ({
                    source: nodeMap.get(e.source)!,
                    target: nodeMap.get(e.target)!,
                    dependency_type: e.dependency_type,
                }));

            simNodesRef.current = simNodes;
            simLinksRef.current = simLinks;

            // Determine force strengths based on graph size
            const n = nodes.length;
            const isLarge = n > 1000;
            const isMedium = n > 200;
            const chargeStrength = isLarge ? -80 : isMedium ? -150 : -200;
            const linkDistance = isLarge ? 60 : isMedium ? 80 : 100;
            const collisionPadding = isLarge ? 6 : 8;
            const alphaDecay = isLarge ? 0.04 : 0.0228;

            if (simulationRef.current) simulationRef.current.stop();

            const simulation = d3.forceSimulation<SimNode>(simNodes)
                .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(linkDistance))
                .force('charge', d3.forceManyBody().strength(chargeStrength))
                .force('center', d3.forceCenter(0, 0))
                .force('collision', d3.forceCollide<SimNode>().radius((d) => d.radius + collisionPadding))
                .alphaDecay(alphaDecay);

            simulationRef.current = simulation;

            // Rendering loop
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const render = () => {
                pulseRef.current = (pulseRef.current + 0.02) % (Math.PI * 2);
                const dpr = window.devicePixelRatio || 1;
                const width = canvas.clientWidth;
                const height = canvas.clientHeight;

                if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
                    canvas.width = width * dpr;
                    canvas.height = height * dpr;
                }

                ctx.save();
                ctx.scale(dpr, dpr);
                ctx.clearRect(0, 0, width, height);
                ctx.fillStyle = '#030712';
                ctx.fillRect(0, 0, width, height);

                const t = transformRef.current;
                ctx.translate(t.x, t.y);
                ctx.scale(t.k, t.k);

                drawGraph(ctx, simNodes, simLinks, query, hoveredNodeRef.current, pulseRef.current);

                ctx.restore();
                animFrameRef.current = requestAnimationFrame(render);
            };

            animFrameRef.current = requestAnimationFrame(render);

            simulation.on('tick', () => {
                // rendering handled by rAF loop
            });

            return () => {
                simulation.stop();
                cancelAnimationFrame(animFrameRef.current);
            };
        }, [nodes, edges, searchQuery, dependentCounts]);

        // Zoom + Pan
        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const zoomBehavior = d3.zoom<HTMLCanvasElement, unknown>()
                .scaleExtent([0.05, 10])
                .on('zoom', (event) => {
                    transformRef.current = event.transform;
                });

            zoomBehaviorRef.current = zoomBehavior;
            const sel = d3.select(canvas);
            sel.call(zoomBehavior);

            // Set initial transform so the graph (centered at 0,0) appears
            // in the middle of the canvas, while keeping d3's zoom math correct.
            const initialTransform = d3.zoomIdentity.translate(canvas.clientWidth / 2, canvas.clientHeight / 2);
            sel.call(zoomBehavior.transform, initialTransform);

            return () => {
                sel.on('.zoom', null);
            };
        }, []);

        // Mouse interactions (hover + click)
        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const getNodeAtPoint = (clientX: number, clientY: number): SimNode | null => {
                const rect = canvas.getBoundingClientRect();
                const t = transformRef.current;
                const mx = (clientX - rect.left - t.x) / t.k;
                const my = (clientY - rect.top - t.y) / t.k;

                for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
                    const node = simNodesRef.current[i];
                    const dx = (node.x ?? 0) - mx;
                    const dy = (node.y ?? 0) - my;
                    if (dx * dx + dy * dy <= (node.radius + 3) * (node.radius + 3)) {
                        return node;
                    }
                }
                return null;
            };

            const handleMouseMove = (e: MouseEvent) => {
                const node = getNodeAtPoint(e.clientX, e.clientY);
                hoveredNodeRef.current = node;
                canvas.style.cursor = node ? 'pointer' : 'grab';
            };

            const handleClick = (e: MouseEvent) => {
                const node = getNodeAtPoint(e.clientX, e.clientY);
                if (node) {
                    onNodeClick({
                        id: node.id,
                        contract_id: node.contract_id,
                        name: node.name,
                        network: node.network,
                        is_verified: node.is_verified,
                        category: node.category,
                        tags: node.tags,
                    });
                } else {
                    onNodeClick(null);
                }
            };

            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('click', handleClick);

            return () => {
                canvas.removeEventListener('mousemove', handleMouseMove);
                canvas.removeEventListener('click', handleClick);
            };
        }, [onNodeClick]);

        // Resize handler
        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const observer = new ResizeObserver(() => {
                const dpr = window.devicePixelRatio || 1;
                canvas.width = canvas.clientWidth * dpr;
                canvas.height = canvas.clientHeight * dpr;
            });

            observer.observe(canvas);
            return () => observer.disconnect();
        }, []);

        // Drag behavior
        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas || !simulationRef.current) return;

            let draggedNode: SimNode | null = null;

            const handleDragStart = (e: MouseEvent) => {
                if (e.button !== 0) return;
                const rect = canvas.getBoundingClientRect();
                const t = transformRef.current;
                const mx = (e.clientX - rect.left - t.x) / t.k;
                const my = (e.clientY - rect.top - t.y) / t.k;

                for (let i = simNodesRef.current.length - 1; i >= 0; i--) {
                    const node = simNodesRef.current[i];
                    const dx = (node.x ?? 0) - mx;
                    const dy = (node.y ?? 0) - my;
                    if (dx * dx + dy * dy <= (node.radius + 3) * (node.radius + 3)) {
                        draggedNode = node;
                        node.fx = node.x;
                        node.fy = node.y;
                        simulationRef.current!.alphaTarget(0.3).restart();
                        e.preventDefault();
                        e.stopPropagation();
                        break;
                    }
                }
            };

            const handleDragMove = (e: MouseEvent) => {
                if (!draggedNode) return;
                const rect = canvas.getBoundingClientRect();
                const t = transformRef.current;
                draggedNode.fx = (e.clientX - rect.left - t.x) / t.k;
                draggedNode.fy = (e.clientY - rect.top - t.y) / t.k;
            };

            const handleDragEnd = () => {
                if (!draggedNode) return;
                draggedNode.fx = null;
                draggedNode.fy = null;
                draggedNode = null;
                simulationRef.current!.alphaTarget(0);
            };

            canvas.addEventListener('mousedown', handleDragStart);
            window.addEventListener('mousemove', handleDragMove);
            window.addEventListener('mouseup', handleDragEnd);

            return () => {
                canvas.removeEventListener('mousedown', handleDragStart);
                window.removeEventListener('mousemove', handleDragMove);
                window.removeEventListener('mouseup', handleDragEnd);
            };
        }, [nodes, edges]);

        return (
            <div ref={containerRef} className="absolute inset-0">
                <canvas
                    ref={canvasRef}
                    className="w-full h-full"
                    style={{ touchAction: 'none' }}
                />

                {/* Hover tooltip */}
                {hoveredNodeRef.current && (
                    <div
                        className="fixed z-50 pointer-events-none bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl"
                        style={{
                            left: 0,
                            top: 0,
                            transform: 'translate(-50%, -120%)',
                            opacity: 0, // We handle tooltip positioning via render
                        }}
                    />
                )}
            </div>
        );
    }
);

DependencyGraph.displayName = 'DependencyGraph';

function drawGraph(
    ctx: CanvasRenderingContext2D,
    nodes: SimNode[],
    links: SimLink[],
    searchQuery: string,
    hoveredNode: SimNode | null,
    pulse: number
) {
    const hasSearch = searchQuery.length > 0;

    // Draw edges
    ctx.lineWidth = 1;
    for (const link of links) {
        const s = link.source as SimNode;
        const t = link.target as SimNode;
        const sx = s.x ?? 0;
        const sy = s.y ?? 0;
        const tx = t.x ?? 0;
        const ty = t.y ?? 0;

        const isHighlighted = hoveredNode && (s.id === hoveredNode.id || t.id === hoveredNode.id);

        if (hasSearch && !s.isSearchMatch && !t.isSearchMatch) {
            ctx.strokeStyle = 'rgba(55, 65, 81, 0.15)';
        } else if (isHighlighted) {
            ctx.strokeStyle = 'rgba(96, 165, 250, 0.6)';
            ctx.lineWidth = 2;
        } else {
            ctx.strokeStyle = 'rgba(55, 65, 81, 0.5)';
        }

        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(tx, ty);
        ctx.stroke();

        // Arrowhead
        const angle = Math.atan2(ty - sy, tx - sx);
        const arrowLen = 6;
        const ar = t.radius + 3;
        const ax = tx - Math.cos(angle) * ar;
        const ay = ty - Math.sin(angle) * ar;

        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(
            ax - arrowLen * Math.cos(angle - Math.PI / 6),
            ay - arrowLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
            ax - arrowLen * Math.cos(angle + Math.PI / 6),
            ay - arrowLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();

        ctx.lineWidth = 1;
    }

    // Draw nodes
    for (const node of nodes) {
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const r = node.radius;
        const color = NETWORK_COLORS[node.network] || '#6b7280';
        const dimColor = NETWORK_COLORS_DIM[node.network] || '#374151';

        const isDimmed = hasSearch && !node.isSearchMatch;

        // Critical node glow (pulsing)
        if (node.isCritical && !isDimmed) {
            const glowSize = 4 + Math.sin(pulse) * 2;
            ctx.beginPath();
            ctx.arc(x, y, r + glowSize, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(251, 191, 36, ${0.15 + Math.sin(pulse) * 0.08})`;
            ctx.fill();

            ctx.beginPath();
            ctx.arc(x, y, r + 3, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(251, 191, 36, ${0.5 + Math.sin(pulse) * 0.2})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Search match ring
        if (hasSearch && node.isSearchMatch) {
            ctx.beginPath();
            ctx.arc(x, y, r + 4, 0, Math.PI * 2);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // Selected ring
        if (hoveredNode && node.id === hoveredNode.id) {
            ctx.beginPath();
            ctx.arc(x, y, r + 5, 0, Math.PI * 2);
            ctx.strokeStyle = '#60a5fa';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Main circle
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = isDimmed ? dimColor : color;
        ctx.globalAlpha = isDimmed ? 0.3 : 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Verified badge
        if (node.is_verified && !isDimmed && r >= 6) {
            ctx.beginPath();
            ctx.arc(x + r * 0.7, y - r * 0.7, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#22c55e';
            ctx.fill();
            ctx.strokeStyle = '#030712';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Label for larger nodes
        if (r >= 6 && !isDimmed) {
            ctx.fillStyle = '#d1d5db';
            ctx.font = '10px Inter, system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(truncate(node.name, 15), x, y + r + 4);
        }
    }
}

function truncate(str: string, max: number) {
    return str.length <= max ? str : str.slice(0, max - 1) + '…';
}

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }, 100);
}

export default DependencyGraph;
