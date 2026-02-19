use anyhow::{Context, Result};
use colored::Colorize;
use serde_json::json;

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

pub async fn migrate(
    api_url: &str,
    contract_id: &str,
    wasm_path: &str,
    simulate_fail: bool,
    dry_run: bool,
) -> Result<()> {
    use sha2::{Digest, Sha256};
    use std::fs;
    use tokio::process::Command;

    println!("\n{}", "Migration Tool".bold().cyan());
    println!("{}", "=".repeat(80).cyan());

    // 1. Read WASM file
    let wasm_bytes = fs::read(wasm_path)
        .with_context(|| format!("Failed to read WASM file at {}", wasm_path))?;
    
    // 2. Compute Hash
    let mut hasher = Sha256::new();
    hasher.update(&wasm_bytes);
    let wasm_hash = hex::encode(hasher.finalize());

    println!("Contract ID: {}", contract_id.green());
    println!("WASM Path:   {}", wasm_path);
    println!("WASM Hash:   {}", wasm_hash.bright_black());
    println!("Size:        {} bytes", wasm_bytes.len());

    if dry_run {
        println!("\n{}", "[DRY RUN] No changes will be made.".yellow().bold());
        println!("Would create migration record...");
        println!("Would execute: soroban contract invoke --id {} --wasm {} ...", contract_id, wasm_path);
        return Ok(());
    }

    // 3. Create Migration Record (Pending)
    let client = reqwest::Client::new();
    let create_url = format!("{}/api/migrations", api_url);
    
    let payload = json!({
        "contract_id": contract_id,
        "wasm_hash": wasm_hash,
    });

    print!("\nInitializing migration... ");
    let response = client.post(&create_url)
        .json(&payload)
        .send()
        .await
        .context("Failed to contact registry API")?;

    if !response.status().is_success() {
        println!("{}", "Failed".red());
        let err = response.text().await?;
        anyhow::bail!("API Error: {}", err);
    }

    let migration: serde_json::Value = response.json().await?;
    let migration_id = migration["id"].as_str().unwrap();
    println!("{}", "OK".green());
    println!("Migration ID: {}", migration_id);

    // 4. Execute Migration (Mock or Real)
    println!("\n{}", "Executing migration logic...".bold());
    
    // Check if soroban is installed
    let version_output = Command::new("soroban")
        .arg("--version")
        .output()
        .await;

    let (status, log_output) = if version_output.is_err() {
        println!("{}", "Warning: 'soroban' CLI not found. Running in MOCK mode.".yellow());
        
        if simulate_fail {
             println!("{}", "Simulating FAILURE...".red());
             (shared::models::MigrationStatus::Failed, "Simulation: Migration failed as requested.".to_string())
        } else {
             println!("{}", "Simulating SUCCESS...".green());
             (shared::models::MigrationStatus::Success, "Simulation: Migration succeeded.".to_string())
        }
    } else {
        // Real execution would go here. For now we will just mock it even if soroban exists 
        // because we don't have a real contract to invoke in this environment.
        println!("{}", "Soroban CLI found, but full integration is pending. Running in MOCK mode.".yellow());
         if simulate_fail {
             println!("{}", "Simulating FAILURE...".red());
             (shared::models::MigrationStatus::Failed, "Simulation: Migration failed as requested.".to_string())
        } else {
             println!("{}", "Simulating SUCCESS...".green());
             (shared::models::MigrationStatus::Success, "Simulation: Migration executed successfully via soroban CLI (mocked).".to_string())
        }
    };

    // 5. Update Status
    let update_url = format!("{}/api/migrations/{}", api_url, migration_id);
    let update_payload = json!({
        "status": status,
        "log_output": log_output
    });

    let update_res = client.put(&update_url)
        .json(&update_payload)
        .send()
        .await
        .context("Failed to update migration status")?;

    if !update_res.status().is_success() {
        println!("{}", "Failed to update status!".red());
    } else {
        println!("\n{}", "Migration recorded successfully.".green().bold());
        if status == shared::models::MigrationStatus::Failed {
             println!("{}", "Status: FAILED".red().bold());
        } else {
             println!("{}", "Status: SUCCESS".green().bold());
        }
    }

    Ok(())
}
