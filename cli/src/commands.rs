use anyhow::{Context, Result};
use colored::Colorize;
use serde_json::json;
use shared::{extract_abi, generate_markdown};
use std::fs;

pub async fn search(
    api_url: &str,
    query: &str,
    network: Option<&str>,
    verified_only: bool,
) -> Result<()> {
    let client = reqwest::Client::new();
    let mut url = format!("{}/api/contracts?query={}", api_url, query);

    if let Some(net) = network {
        url.push_str(&format!("&network={}", net));
    }
    if verified_only {
        url.push_str("&verified_only=true");
    }

    let response = client
        .get(&url)
        .send()
        .await
        .context("Failed to search contracts")?;

    let data: serde_json::Value = response.json().await?;
    let items = data["items"].as_array().context("Invalid response")?;

    println!("\n{}", "Search Results:".bold().cyan());
    println!("{}", "=".repeat(80).cyan());

    if items.is_empty() {
        println!("{}", "No contracts found.".yellow());
        return Ok(());
    }

    for contract in items {
        let name = contract["name"].as_str().unwrap_or("Unknown");
        let contract_id = contract["contract_id"].as_str().unwrap_or("");
        let is_verified = contract["is_verified"].as_bool().unwrap_or(false);
        let network = contract["network"].as_str().unwrap_or("");

        println!("\n{} {}", "●".green(), name.bold());
        println!("  ID: {}", contract_id.bright_black());
        println!(
            "  Status: {} | Network: {}",
            if is_verified {
                "✓ Verified".green()
            } else {
                "○ Unverified".yellow()
            },
            network.bright_blue()
        );

        if let Some(desc) = contract["description"].as_str() {
            println!("  {}", desc.bright_black());
        }
    }

    println!("\n{}", "=".repeat(80).cyan());
    println!("Found {} contract(s)\n", items.len());

    Ok(())
}

pub async fn info(api_url: &str, contract_id: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/contracts/{}", api_url, contract_id);

    let response = client
        .get(&url)
        .send()
        .await
        .context("Failed to fetch contract info")?;

    if !response.status().is_success() {
        anyhow::bail!("Contract not found");
    }

    let contract: serde_json::Value = response.json().await?;

    println!("\n{}", "Contract Information:".bold().cyan());
    println!("{}", "=".repeat(80).cyan());

    println!("\n{}: {}", "Name".bold(), contract["name"].as_str().unwrap_or("Unknown"));
    println!("{}: {}", "Contract ID".bold(), contract["contract_id"].as_str().unwrap_or(""));
    println!("{}: {}", "Network".bold(), contract["network"].as_str().unwrap_or("").bright_blue());
    
    let is_verified = contract["is_verified"].as_bool().unwrap_or(false);
    println!(
        "{}: {}",
        "Verified".bold(),
        if is_verified {
            "✓ Yes".green()
        } else {
            "○ No".yellow()
        }
    );

    if let Some(desc) = contract["description"].as_str() {
        println!("\n{}: {}", "Description".bold(), desc);
    }

    if let Some(tags) = contract["tags"].as_array() {
        if !tags.is_empty() {
            print!("\n{}: ", "Tags".bold());
            for (i, tag) in tags.iter().enumerate() {
                if i > 0 {
                    print!(", ");
                }
                print!("{}", tag.as_str().unwrap_or("").bright_magenta());
            }
            println!();
        }
    }

    println!("\n{}", "=".repeat(80).cyan());
    println!();

    Ok(())
}

pub async fn publish(
    api_url: &str,
    contract_id: &str,
    name: &str,
    description: Option<&str>,
    network: &str,
    category: Option<&str>,
    tags: Vec<String>,
    publisher: &str,
) -> Result<()> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/contracts", api_url);

    let payload = json!({
        "contract_id": contract_id,
        "name": name,
        "description": description,
        "network": network,
        "category": category,
        "tags": tags,
        "publisher_address": publisher,
    });

    println!("\n{}", "Publishing contract...".bold().cyan());

    let response = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .context("Failed to publish contract")?;

    if !response.status().is_success() {
        let error_text = response.text().await?;
        anyhow::bail!("Failed to publish: {}", error_text);
    }

    let contract: serde_json::Value = response.json().await?;

    println!("{}", "✓ Contract published successfully!".green().bold());
    println!("\n{}: {}", "Name".bold(), contract["name"].as_str().unwrap_or(""));
    println!("{}: {}", "ID".bold(), contract["contract_id"].as_str().unwrap_or(""));
    println!("{}: {}", "Network".bold(), contract["network"].as_str().unwrap_or("").bright_blue());
    println!();

    Ok(())
}

pub async fn list(api_url: &str, limit: usize, network: Option<&str>) -> Result<()> {
    let client = reqwest::Client::new();
    let mut url = format!("{}/api/contracts?page_size={}", api_url, limit);

    if let Some(net) = network {
        url.push_str(&format!("&network={}", net));
    }

    let response = client
        .get(&url)
        .send()
        .await
        .context("Failed to list contracts")?;

    let data: serde_json::Value = response.json().await?;
    let items = data["items"].as_array().context("Invalid response")?;

    println!("\n{}", "Recent Contracts:".bold().cyan());
    println!("{}", "=".repeat(80).cyan());

    if items.is_empty() {
        println!("{}", "No contracts found.".yellow());
        return Ok(());
    }

    for (i, contract) in items.iter().enumerate() {
        let name = contract["name"].as_str().unwrap_or("Unknown");
        let contract_id = contract["contract_id"].as_str().unwrap_or("");
        let is_verified = contract["is_verified"].as_bool().unwrap_or(false);
        let network = contract["network"].as_str().unwrap_or("");

        println!(
            "\n{}. {} {}",
            i + 1,
            name.bold(),
            if is_verified { "✓".green() } else { "".normal() }
        );
        println!("   {} | {}", contract_id.bright_black(), network.bright_blue());
    }

    println!("\n{}", "=".repeat(80).cyan());
    println!();

    Ok(())
}

pub fn doc(contract_path: &str, output_dir: &str) -> Result<()> {
    let specs = extract_abi(contract_path)?;
    let name = std::path::Path::new(contract_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("contract");

    fs::create_dir_all(output_dir)?;

    let md = generate_markdown(&specs, name);
    fs::write(format!("{}/{}.md", output_dir, name), md)?;

    let json = serde_json::to_string_pretty(&specs)?;
    fs::write(format!("{}/{}.abi.json", output_dir, name), json)?;

    println!("{}", "✓ Documentation generated".green());
    Ok(())
}
