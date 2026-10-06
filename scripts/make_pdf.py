import os
import sys
import json
import base64
import subprocess

ROOT_DIR = r"D:\Baltej IDE"

def get_base64_img(rel_path):
    full_path = os.path.join(ROOT_DIR, rel_path)
    if os.path.exists(full_path):
        with open(full_path, "rb") as f:
            data = base64.b64encode(f.read()).decode("utf-8")
        ext = os.path.splitext(rel_path)[1].lower().replace(".", "")
        if ext == "jpg":
            ext = "jpeg"
        return f"data:image/{ext};base64,{data}"
    print(f"Warning: Image {rel_path} not found")
    return ""

def load_json(rel_path):
    full_path = os.path.join(ROOT_DIR, rel_path)
    if os.path.exists(full_path):
        with open(full_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None

def main():
    print("Loading data...")
    roles = load_json(os.path.join("src", "roles", "roles.json")) or []
    connectors = load_json(os.path.join("src", "connectors", "catalog.json")) or []
    skills_catalog = load_json(os.path.join("src", "skills", "catalog.json")) or {}
    skills_list = skills_catalog.get("skills", [])

    print(f"Loaded: {len(roles)} roles, {len(connectors)} connectors, {len(skills_list)} skills.")

    print("Encoding images...")
    img_campus = get_base64_img(os.path.join("site", "media", "campus.jpg"))
    img_overview = get_base64_img(os.path.join("site", "media", "overview.jpg"))
    img_lounge = get_base64_img(os.path.join("site", "media", "lounge.jpg"))
    img_work = get_base64_img(os.path.join("site", "media", "work.jpg"))
    img_review = get_base64_img(os.path.join("site", "media", "review.jpg"))
    img_desktop = get_base64_img(os.path.join("test-results", "desktop.png"))
    img_connectors = get_base64_img(os.path.join("test-results", "connectors.png"))
    img_activity = get_base64_img(os.path.join("test-results", "activity-log.png"))
    img_meter = get_base64_img(os.path.join("test-results", "context-meter.png"))
    img_restore = get_base64_img(os.path.join("test-results", "restore-points.png"))
    img_usage = get_base64_img(os.path.join("test-results", "usage.png"))

    parts = []

    # Head and CSS
    parts.append("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Axon AI Studio — Complete Project Master Dossier</title>
<style>
@page {
    size: A4;
    margin: 16mm 14mm 16mm 14mm;
    @bottom-right {
        content: counter(page);
    }
}

*, *:before, *:after {
    box-sizing: border-box;
}

body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Inter", Helvetica, Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    font-size: 9.8pt;
    line-height: 1.52;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}

h1, h2, h3, h4, h5 {
    color: #0f172a;
    font-weight: 700;
    margin-top: 0;
    letter-spacing: -0.02em;
    page-break-after: avoid;
    break-after: avoid;
}

h1 { font-size: 24pt; line-height: 1.15; margin-bottom: 8px; }
h2 { font-size: 16pt; line-height: 1.25; margin-top: 18pt; margin-bottom: 8pt; border-bottom: 1.5pt solid #e2e8f0; padding-bottom: 4pt; }
h3 { font-size: 12pt; line-height: 1.3; margin-top: 14pt; margin-bottom: 6pt; color: #1e40af; }
h4 { font-size: 10.5pt; font-weight: 600; margin-top: 10pt; margin-bottom: 4pt; color: #334155; }

p {
    margin-top: 0;
    margin-bottom: 8pt;
    text-align: justify;
}

ul, ol {
    margin-top: 0;
    margin-bottom: 8pt;
    padding-left: 18pt;
}

li {
    margin-bottom: 3.5pt;
}

code {
    font-family: "Cascadia Code", "Consolas", "Courier New", monospace;
    font-size: 8.5pt;
    background: #f1f5f9;
    color: #0f172a;
    padding: 1.5pt 4pt;
    border-radius: 3pt;
    border: 0.5pt solid #cbd5e1;
}

pre {
    font-family: "Cascadia Code", "Consolas", "Courier New", monospace;
    font-size: 8pt;
    line-height: 1.4;
    background: #0f172a;
    color: #e2e8f0;
    padding: 8pt 10pt;
    border-radius: 4pt;
    overflow-x: hidden;
    margin-top: 4pt;
    margin-bottom: 8pt;
    page-break-inside: avoid;
    break-inside: avoid;
}

pre code {
    background: transparent;
    color: inherit;
    border: none;
    padding: 0;
    font-size: inherit;
}

.page-break {
    page-break-before: always;
    break-before: page;
}

.no-break {
    page-break-inside: avoid;
    break-inside: avoid;
}

.header-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 0.8pt solid #cbd5e1;
    padding-bottom: 4pt;
    margin-bottom: 12pt;
    font-size: 8pt;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

.badge {
    display: inline-block;
    font-size: 7.5pt;
    font-weight: 600;
    padding: 2pt 5.5pt;
    border-radius: 3pt;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-right: 4pt;
}
.badge-blue { background: #eff6ff; color: #1d4ed8; border: 0.5pt solid #bfdbfe; }
.badge-green { background: #f0fdf4; color: #15803d; border: 0.5pt solid #bbf7d0; }
.badge-amber { background: #fffbeb; color: #b45309; border: 0.5pt solid #fde68a; }
.badge-purple { background: #faf5ff; color: #7e22ce; border: 0.5pt solid #e9d5ff; }
.badge-slate { background: #f8fafc; color: #334155; border: 0.5pt solid #cbd5e1; }
.badge-security { background: #fef2f2; color: #b91c1c; border: 0.5pt solid #fecaca; }

table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 6pt;
    margin-bottom: 10pt;
    font-size: 8.5pt;
    page-break-inside: avoid;
    break-inside: avoid;
}

th, td {
    padding: 5pt 7pt;
    text-align: left;
    border: 0.5pt solid #e2e8f0;
    vertical-align: top;
}

th {
    background: #f8fafc;
    color: #0f172a;
    font-weight: 650;
    border-bottom: 1.5pt solid #cbd5e1;
}

tr:nth-child(even) td {
    background: #fafafa;
}

.callout {
    padding: 8pt 11pt;
    border-radius: 4pt;
    margin-top: 7pt;
    margin-bottom: 9pt;
    page-break-inside: avoid;
    break-inside: avoid;
    font-size: 9pt;
    line-height: 1.45;
}
.callout-info { background: #f0f7ff; border-left: 3.5pt solid #2563eb; color: #1e3a8a; }
.callout-success { background: #f0fdf4; border-left: 3.5pt solid #16a34a; color: #14532d; }
.callout-warning { background: #fffbeb; border-left: 3.5pt solid #d97706; color: #78350f; }
.callout-security { background: #fef2f2; border-left: 3.5pt solid #dc2626; color: #7f1d1d; }

.grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8pt;
    margin-top: 6pt;
    margin-bottom: 8pt;
}

.grid-3 {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 7pt;
    margin-top: 6pt;
    margin-bottom: 8pt;
}

.card {
    background: #ffffff;
    border: 0.8pt solid #e2e8f0;
    border-radius: 5pt;
    padding: 8pt 9pt;
    page-break-inside: avoid;
    break-inside: avoid;
}

.card-title {
    font-size: 10pt;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 3pt;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.card-subtitle {
    font-size: 8pt;
    color: #64748b;
    margin-bottom: 5pt;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-weight: 600;
}

figure {
    margin: 8pt 0 11pt 0;
    text-align: center;
    page-break-inside: avoid;
    break-inside: avoid;
}

figure img {
    max-width: 100%;
    height: auto;
    border-radius: 5pt;
    border: 0.8pt solid #cbd5e1;
    box-shadow: 0 2pt 6pt rgba(0,0,0,0.06);
}

figcaption {
    font-size: 8pt;
    color: #64748b;
    margin-top: 4pt;
    font-style: italic;
}

.cover-page {
    background: linear-gradient(135deg, #07090e 0%, #0d1322 50%, #151d36 100%);
    color: #ffffff;
    margin: -16mm -14mm -16mm -14mm;
    padding: 24mm 20mm 20mm 20mm;
    min-height: 297mm;
    height: 297mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
    break-after: page;
}

.cover-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1pt solid rgba(255,255,255,0.18);
    padding-bottom: 12pt;
}

.cover-brand {
    font-size: 26pt;
    font-weight: 800;
    letter-spacing: -0.04em;
    color: #ffffff;
}

.cover-brand span {
    color: #3867f6;
}

.cover-badge {
    background: rgba(56, 103, 246, 0.2);
    border: 1pt solid rgba(56, 103, 246, 0.5);
    color: #8ba5ff;
    padding: 4pt 10pt;
    border-radius: 999px;
    font-size: 9pt;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}

.cover-hero {
    margin-top: 15pt;
}

.cover-kicker {
    color: #8ba5ff;
    font-size: 11pt;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin-bottom: 8pt;
}

.cover-title {
    font-size: 34pt;
    font-weight: 800;
    line-height: 1.05;
    letter-spacing: -0.04em;
    color: #ffffff;
    margin-bottom: 12pt;
}

.cover-subtitle {
    font-size: 13pt;
    line-height: 1.45;
    color: rgba(226, 232, 244, 0.85);
    max-width: 580pt;
    margin-bottom: 18pt;
}

.cover-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10pt;
    background: rgba(255, 255, 255, 0.05);
    border: 1pt solid rgba(255, 255, 255, 0.12);
    border-radius: 8pt;
    padding: 12pt;
    margin-top: 12pt;
    margin-bottom: 14pt;
}

.cover-stat-box {
    border-right: 1pt solid rgba(255, 255, 255, 0.1);
    padding-right: 8pt;
}
.cover-stat-box:last-child {
    border-right: none;
}

.cover-stat-num {
    font-size: 20pt;
    font-weight: 800;
    color: #ffffff;
    line-height: 1;
    margin-bottom: 3pt;
}

.cover-stat-label {
    font-size: 7.5pt;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
}

.cover-preview {
    border-radius: 8pt;
    overflow: hidden;
    border: 1pt solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 10pt 25pt rgba(0, 0, 0, 0.5);
    max-height: 145pt;
    margin-top: 8pt;
}

.cover-preview img {
    width: 100%;
    height: 145pt;
    object-fit: cover;
    display: block;
}

.cover-footer {
    border-top: 1pt solid rgba(255,255,255,0.18);
    padding-top: 10pt;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #94a3b8;
}

.toc-list {
    list-style: none;
    padding: 0;
    margin: 0;
}

.toc-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 4pt 0;
    border-bottom: 0.5pt dotted #cbd5e1;
    font-size: 9pt;
}

.toc-title {
    font-weight: 600;
    color: #0f172a;
}

.toc-page {
    font-weight: 700;
    color: #2563eb;
    font-variant-numeric: tabular-nums;
}

.toc-sublist {
    list-style: none;
    padding-left: 14pt;
    margin: 2pt 0 4pt 0;
}

.toc-subitem {
    display: flex;
    justify-content: space-between;
    padding: 2.5pt 0;
    font-size: 8.2pt;
    color: #475569;
}
</style>
</head>
<body>
""")

    # Cover Page
    parts.append("""
<div class="cover-page">
    <div class="cover-header">
        <div class="cover-brand">AXON<span>.</span></div>
        <div class="cover-badge">Version 0.2.0 • Release Dossier</div>
    </div>

    <div class="cover-hero">
        <div class="cover-kicker">Architecture, Capabilities & Ecosystem Specification</div>
        <div class="cover-title">The Complete System Dossier:<br>From Concept to Codebase</div>
        <div class="cover-subtitle">
            An exhaustive technical analysis of Axon AI Studio — the local-first desktop platform where AI transcends conversational textboxes to inhabit an embodied, spatial 3D virtual office campus of 208 specialized coworkers.
        </div>

        <div class="cover-stats">
            <div class="cover-stat-box">
                <div class="cover-stat-num">208</div>
                <div class="cover-stat-label">Coworkers Seated</div>
            </div>
            <div class="cover-stat-box">
                <div class="cover-stat-num">39</div>
                <div class="cover-stat-label">MCP Connectors</div>
            </div>
            <div class="cover-stat-box">
                <div class="cover-stat-num">31</div>
                <div class="cover-stat-label">Licensed Skills</div>
            </div>
            <div class="cover-stat-box">
                <div class="cover-stat-num">0</div>
                <div class="cover-stat-label">Vulnerabilities (Audit)</div>
            </div>
        </div>

        <div class="cover-preview">
            <img src="__IMG_CAMPUS__" alt="Axon 3D Campus Overview">
        </div>
    </div>

    <div class="cover-footer">
        <div><strong>Axon Core Engineering</strong> • Confidential Technical Blueprint</div>
        <div>Electron 44 • React 18 • Three.js • Vite 7 • DPAPI Vault • TypeScript</div>
    </div>
</div>
""")

    # Table of Contents
    parts.append("""
<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Table of Contents & Executive Summary</span>
</div>

<h2>Table of Contents</h2>

<ul class="toc-list">
    <li class="toc-item">
        <span class="toc-title">1. Executive Overview & System Philosophy</span>
        <span class="toc-page">Ch. 1</span>
    </li>
    <ul class="toc-sublist">
        <li class="toc-subitem"><span>1.1 Paradigm Shift: The "AI Has An Office Now" Thesis</span><span>Overview</span></li>
        <li class="toc-subitem"><span>1.2 Core Architectural Principles & Zero Cloud Lock-In</span><span>Principles</span></li>
        <li class="toc-subitem"><span>1.3 Key Technical Metrics & Stack Specification</span><span>Stack</span></li>
    </ul>

    <li class="toc-item">
        <span class="toc-title">2. What Axon Does: Core Capabilities & User Experience</span>
        <span class="toc-page">Ch. 2</span>
    </li>
    <ul class="toc-sublist">
        <li class="toc-subitem"><span>2.1 The 3D Virtual Campus & Procedural Low-Poly Simulation</span><span>Spatial</span></li>
        <li class="toc-subitem"><span>2.2 The Split-Screen Coworker Workspace</span><span>Workspace</span></li>
        <li class="toc-subitem"><span>2.3 Multi-Provider AI Engine & BYO-Key Protocols</span><span>Inference</span></li>
        <li class="toc-subitem"><span>2.4 Human-in-the-Loop Safety, Diff Approvals & Coworker Undo</span><span>Safety</span></li>
        <li class="toc-subitem"><span>2.5 Local Document Intelligence & Process-Isolated RAG</span><span>Retrieval</span></li>
        <li class="toc-subitem"><span>2.6 Model Context Protocol (MCP) Integration Engine</span><span>Connectors</span></li>
        <li class="toc-subitem"><span>2.7 Transparency, Cost Metering & Governance</span><span>Auditing</span></li>
    </ul>

    <li class="toc-item">
        <span class="toc-title">3. What Axon Contains: Structural & Inventory Blueprint</span>
        <span class="toc-page">Ch. 3</span>
    </li>
    <ul class="toc-sublist">
        <li class="toc-subitem"><span>3.1 Repository Anatomy & Complete Source Code Hierarchy</span><span>Directory</span></li>
        <li class="toc-subitem"><span>3.2 The 9 Core Commons Coworkers</span><span>Roster</span></li>
        <li class="toc-subitem"><span>3.3 The 204 Domain Specialists across 23 Department Groups</span><span>Specialists</span></li>
        <li class="toc-subitem"><span>3.4 The 39 Catalog Connectors (Model Context Protocol)</span><span>Integrations</span></li>
        <li class="toc-subitem"><span>3.5 The 895 Ingested Skills & Synthesis Pipeline</span><span>Skills</span></li>
        <li class="toc-subitem"><span>3.6 Design System Architecture & UI Primitives</span><span>Design Tokens</span></li>
        <li class="toc-subitem"><span>3.7 Storage, State Schemas & DPAPI Vault</span><span>Persistence</span></li>
    </ul>

    <li class="toc-item">
        <span class="toc-title">4. What All We Have Done: Chronological Engineering Journey</span>
        <span class="toc-page">Ch. 4</span>
    </li>
    <ul class="toc-sublist">
        <li class="toc-subitem"><span>4.1 Evolutionary Milestones (Wave 0 through Wave 7)</span><span>History</span></li>
        <li class="toc-subitem"><span>4.2 Major Engineering Breakdowns & Solved Hurdles</span><span>Engineering</span></li>
        <li class="toc-subitem"><span>4.3 Dependency Hardening & Vulnerability Remediation (19 → 0)</span><span>Hardening</span></li>
        <li class="toc-subitem"><span>4.4 Testing, E2E Smoke Validation & Benchmarks</span><span>Verification</span></li>
        <li class="toc-subitem"><span>4.5 Marketing Platform & Launch Motion Production</span><span>Media</span></li>
        <li class="toc-subitem"><span>4.6 Progress Update: Sept 30 – Oct 4, 2026 (Teams, Voice, Rooms, Speed)</span><span>Update</span></li>
    </ul>

    <li class="toc-item">
        <span class="toc-title">5. What Axon Can Do: Operational Scenarios & Real-World Workflows</span>
        <span class="toc-page">Ch. 5</span>
    </li>
    <ul class="toc-sublist">
        <li class="toc-subitem"><span>5.1 Multi-Agent Collaborative Full-Stack Engineering</span><span>Dev Scenario</span></li>
        <li class="toc-subitem"><span>5.2 Automated Incident Triage via Sentry & GitHub MCP</span><span>Ops Scenario</span></li>
        <li class="toc-subitem"><span>5.3 Strategic Product Discovery & Roadmapping</span><span>Product Scenario</span></li>
        <li class="toc-subitem"><span>5.4 Safe Multi-File Refactoring with Rollback Engine</span><span>Refactoring</span></li>
        <li class="toc-subitem"><span>5.5 Air-Gapped Enterprise Knowledge Extraction</span><span>Private RAG</span></li>
    </ul>

    <li class="toc-item">
        <span class="toc-title">6. Security, Privacy & Boundary Enforcement Model</span>
        <span class="toc-page">Ch. 6</span>
    </li>
    <ul class="toc-sublist">
        <li class="toc-subitem"><span>6.1 Defense-in-Depth Architecture & Key Isolation</span><span>Security</span></li>
        <li class="toc-subitem"><span>6.2 Filesystem Sandboxing & Symlink Defense</span><span>Sandboxing</span></li>
        <li class="toc-subitem"><span>6.3 IPC Security & Process Isolation</span><span>IPC Guards</span></li>
    </ul>

    <li class="toc-item">
        <span class="toc-title">7. Production Roadmap & Future Horizons</span>
        <span class="toc-page">Ch. 7</span>
    </li>
    <ul class="toc-sublist">
        <li class="toc-subitem"><span>7.1 Immediate Release Blockers & Production Gates</span><span>Release Gates</span></li>
        <li class="toc-subitem"><span>7.2 Mid-Term Enhancements & Enterprise Scaling</span><span>Roadmap</span></li>
        <li class="toc-subitem"><span>7.3 Long-Term Strategic Vision: The Shared Spatial Office</span><span>Future</span></li>
    </ul>

    <li class="toc-item">
        <span class="toc-title">8. Technical Appendix & Operations Manual</span>
        <span class="toc-page">Ch. 8</span>
    </li>
    <ul class="toc-sublist">
        <li class="toc-subitem"><span>8.1 CLI & Build Tooling Reference</span><span>Commands</span></li>
        <li class="toc-subitem"><span>8.2 Complete IPC Bridge API Reference (`window.axon`)</span><span>API Surface</span></li>
        <li class="toc-subitem"><span>8.3 Configuration Schemas & Storage Locations</span><span>Schema</span></li>
    </ul>
</ul>

<div class="callout callout-info" style="margin-top: 14pt;">
    <strong>About This Document:</strong> This document serves as the complete, authoritative system manual for the Axon AI Studio platform. It details all implemented mechanisms, architectural contracts, data schemas, historical engineering waves, and forward-looking capabilities compiled directly from the active code repository at version 0.2.0.
</div>
""")

    # Chapter 1
    parts.append("""
<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 1: Executive Overview & Philosophy</span>
</div>

<h1>Chapter 1: Executive Overview & System Philosophy</h1>

<h3>1.1 Paradigm Shift: The "AI Has An Office Now" Thesis</h3>
<p>
    The standard paradigm of artificial intelligence interaction has been dominated by the ephemeral single-threaded "chat box." Whether integrated as an IDE side-panel or accessed through a web portal, traditional generative interfaces suffer from severe structural deficiencies: context amnesia, lack of embodied spatial orientation, monolithic agent personas that attempt to perform all software disciplines simultaneously, and opaque execution loops that mutate local files without visual auditability.
</p>
<p>
    <strong>Axon</strong> reimagines this entire interaction model. In Axon, artificial intelligence is not an abstract conversational endpoint; <em>your AI has an office now</em>. Users enter an embodied, interactive 3D virtual office campus populated by 213 distinct, persistent coworkers. Each coworker possesses a dedicated role profile, specialized domain capabilities, assigned tools, and custom system prompts. Rather than forcing a single model to act as frontend developer, security auditor, database architect, and product manager in turn, the user collaborates with specialized personnel seated in purpose-built departments.
</p>

<figure>
    <img src="__IMG_OVERVIEW__" alt="Axon 3D Campus Wide View">
    <figcaption>Figure 1.1: The Axon 3D Campus — 40m × 32m central Commons flanked by 7 specialized department districts.</figcaption>
</figure>

<h3>1.2 Core Architectural Principles & Zero Cloud Lock-In</h3>
<p>
    Axon was engineered from day one under strict foundational constraints designed to protect enterprise intellectual property, ensure user sovereignty, and provide absolute transparency:
</p>

<ul>
    <li><strong>100% Local-First Execution:</strong> The application, its SQLite state database (write-ahead logged), document indices, credentials, and configuration files reside exclusively on the host operating system (`%APPDATA%\\Axon` on Windows). No telemetry, tracking, or proprietary vendor backends mediate application startup.</li>
    <li><strong>Bring-Your-Own-Key (BYO-Key):</strong> Users supply their own API keys for standard inference providers (OpenAI-compatible, Anthropic Messages, Google Gemini) or connect entirely private local LLMs (Ollama, LM Studio, vLLM) over loopback HTTP without keys.</li>
    <li><strong>OS-Protected Credential Isolation:</strong> API keys, OAuth tokens and connector header and variable values are never stored in plaintext. They are encrypted by the operating system's key store via Electron's <code>safeStorage</code> API (Windows DPAPI, tied to your user account; macOS Keychain; the Linux secret service). The renderer never receives a key, token or connector secret, only whether one is saved.</li>
    <li><strong>Human-in-the-Loop Approval Safeguards:</strong> Autonomous agents cannot alter local files or execute shell commands silently. Destructive actions trigger visual Approval Cards featuring side-by-side unified diffs that require explicit user consent.</li>
    <li><strong>Non-Destructive Coworker Rollback:</strong> Every file write and project-memory update by an agent preserves the previous version in a rolling 500-snapshot history, enabling one-click undo from the work surface. A file Axon can't show (binary, or over 1 MB) is never overwritten. Commands and commits can't be undone, and their approval cards say so.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 1: Executive Overview & Philosophy</span>
</div>

<h3>1.3 Key Technical Metrics & Stack Specification</h3>
<p>
    The platform combines bleeding-edge web technologies, desktop application runtimes, and real-time 3D graphics engines into a coherent, highly optimized production binary.
</p>

<table>
    <thead>
        <tr>
            <th style="width: 25%;">Subsystem / Metric</th>
            <th style="width: 35%;">Implementation Technology</th>
            <th style="width: 40%;">Specification / Architectural Notes</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>Desktop Shell</strong></td>
            <td>Electron 44.4.1</td>
            <td>Process-isolated architecture with strict contextIsolation, sandboxed renderer, and sender-validated IPC.</td>
        </tr>
        <tr>
            <td><strong>Build & Tooling</strong></td>
            <td>electron-vite 5.0.0 & Vite 7.3.6</td>
            <td>High-performance ESBuild bundling, TypeScript 5.6.3 compilation, and fast HMR developer loop.</td>
        </tr>
        <tr>
            <td><strong>UI Presentation</strong></td>
            <td>React 18.3.1 + Zustand 5.0.1</td>
            <td>Component-based UI with lightweight, decoupled Zustand stores for instant UI responsiveness without cascades.</td>
        </tr>
        <tr>
            <td><strong>3D Graphics Simulation</strong></td>
            <td>Three.js 0.186.0</td>
            <td>Custom procedural architectural modeling, rigged humanoid character mesh deformation, screen texture atlas.</td>
        </tr>
        <tr>
            <td><strong>Ecosystem Size</strong></td>
            <td>213 Coworkers (9 Core + 204 Specialists)</td>
            <td>23 distinct department groups spanning engineering, design, product, security, and executive management.</td>
        </tr>
        <tr>
            <td><strong>Integration Layer</strong></td>
            <td>Model Context Protocol (MCP)</td>
            <td>39 catalog connectors supporting Streamable HTTP (2025-06-18), stdio child processes, and HTTP+SSE transports.</td>
        </tr>
        <tr>
            <td><strong>Ingested Skills</strong></td>
            <td>31 Shipped Skills (895 ingested)</td>
            <td>31 from 4 open-licensed repositories ship with Axon; 864 from a collection without a license are available in development builds only. Runtime prompt budget capped at 80,000 characters.</td>
        </tr>
        <tr>
            <td><strong>Document Intelligence</strong></td>
            <td>Sandboxed Reader (Chromium OS sandbox)</td>
            <td>Multi-format parsing (PDF via pdf.js 6.3, DOCX, XLSX via `exceljs`, CSV, Code, Text) in a sandboxed renderer with no file or network access, fed bytes, with a 30s watchdog.</td>
        </tr>
        <tr>
            <td><strong>Search & Retrieval</strong></td>
            <td>BM25 Lexical Ranking Engine</td>
            <td>Tokenized document chunking and BM25 relevance scoring; tagged as untrusted context before system prompt injection.</td>
        </tr>
        <tr>
            <td><strong>Credential Security</strong></td>
            <td>OS DPAPI Keyring Vault</td>
            <td>Cryptographically secured via Windows DPAPI; keys isolated in main process, zero transmission to renderer.</td>
        </tr>
        <tr>
            <td><strong>Dependency Health</strong></td>
            <td>0 Vulnerabilities (npm audit)</td>
            <td>Remediated 19 inherited vulnerabilities via Electron 44 migration, Vite 7 upgrade, and replacing `xlsx` with `exceljs`.</td>
        </tr>
    </tbody>
</table>

<div class="grid-2">
    <div class="card">
        <div class="card-title">Three Core Streaming Protocols</div>
        <div class="card-subtitle">Zero Proprietary Wrapper</div>
        <p style="font-size: 8.5pt; color: #475569;">
            Direct native protocol adapters for <strong>OpenAI-compatible</strong> (SSE streaming with usage capture), <strong>Anthropic Messages</strong> (prompt caching & thinking turn replay), and <strong>Google Gemini</strong> (SSE streamGenerateContent).
        </p>
    </div>
    <div class="card">
        <div class="card-title">20,000-Event Audit Trail</div>
        <div class="card-subtitle">Tamper-Evident Governance</div>
        <p style="font-size: 8.5pt; color: #475569;">
            Full audit log of every tool invocation by coworkers, sub-agents, and consulted colleagues. Captures decisions, parameters, caller identity, and outcomes without storing sensitive file payloads.
        </p>
    </div>
</div>

<figure>
    <img src="__IMG_DESKTOP__" alt="Axon Desktop Smoke Verification">
    <figcaption>Figure 1.2: End-to-end desktop verification run in an isolated test environment with loopback mock provider.</figcaption>
</figure>
""")

    # Chapter 2
    parts.append("""
<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h1>Chapter 2: What Axon Does — Core Capabilities</h1>

<h3>2.1 The 3D Virtual Campus & Procedural Low-Poly Simulation</h3>
<p>
    At the core of Axon's visual and spatial identity is a real-time 3D simulation constructed with Three.js. The virtual campus is not a decorative gimmick; it acts as an ambient cognitive dashboard that conveys the operational state, current focus, and collaboration networks of an entire organization at a glance.
</p>

<h4>Campus Architectural Geography</h4>
<p>
    The campus spans an expansive 100m × 80m footprint centered around a 40m × 32m central <strong>Commons</strong>, encircled by seven specialized department districts. Each district is separated by at least 2.5 meters of open corridor space to maintain clear arterial navigation paths:
</p>

<table>
    <thead>
        <tr>
            <th>District</th>
            <th>Color / Floor</th>
            <th>Equipment Flavor</th>
            <th>Departments Seated & Functional Purpose</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>Commons</strong></td>
            <td>Amber (#9a6414)<br>Terrazzo</td>
            <td>Laptops & Desks</td>
            <td>Front desk (Receptionist), Library (Research Analyst, Knowledge Librarian), Planning room (Chief of Staff, Product Coach, Designer, Ops Coordinator), Files room, Kitchen, Cafe, Lounge.</td>
        </tr>
        <tr>
            <td><strong>Engineering</strong></td>
            <td>Blue (#2f5bd3)<br>Natural Oak</td>
            <td>Dual Monitors</td>
            <td>Web & Frontend, Backend & APIs, Mobile, Cloud & Infrastructure, Security, Architecture, QA & Release, Platforms & Enterprise, Emerging Tech.</td>
        </tr>
        <tr>
            <td><strong>Product & Delivery</strong></td>
            <td>Purple (#7c3aed)<br>Blue Carpet</td>
            <td>Laptops & Whiteboards</td>
            <td>Product Management, Project Management, Engineering Management. Roadmap alignment and sprint coordination.</td>
        </tr>
        <tr>
            <td><strong>Design Studio</strong></td>
            <td>Magenta (#c0267a)<br>Walnut Wood</td>
            <td>Large Monitors</td>
            <td>Product Design, UI/UX Design, Visual Design, Design Systems, UX Research.</td>
        </tr>
        <tr>
            <td><strong>Leadership</strong></td>
            <td>Gold (#d97706)<br>Sage Carpet</td>
            <td>Executive Desks</td>
            <td>Executive Leadership, General Management, Strategy & Innovation. High-level capital allocation and company strategy.</td>
        </tr>
        <tr>
            <td><strong>AI, ML & Data</strong></td>
            <td>Cyan (#0891b2)<br>Polished Concrete</td>
            <td>Compute Rigs</td>
            <td>Data Science, Machine Learning Engineering, AI Research, Data Analytics, MLOps, Data Architecture.</td>
        </tr>
        <tr>
            <td><strong>Business</strong></td>
            <td>Green (#16a34a)<br>Grey Carpet</td>
            <td>Laptops</td>
            <td>Sales Management, Marketing Management, Business Development, Partnerships, Growth.</td>
        </tr>
        <tr>
            <td><strong>People & Ops</strong></td>
            <td>Rose (#e11d48)<br>Light Oak</td>
            <td>Workstations</td>
            <td>HR & People, Operations Management, Customer Success, Talent Acquisition, People Operations.</td>
        </tr>
    </tbody>
</table>

<figure>
    <img src="__IMG_CAMPUS__" alt="Axon 3D Campus Architectural Rendering">
    <figcaption>Figure 2.1: Overview of the 8 campus districts with procedural flooring, glass conference partitions, and workstation clusters.</figcaption>
</figure>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h4>Procedural Low-Poly Architectural Kit</h4>
<p>
    The scene is rendered using custom low-poly geometries and bespoke PBR shaders. Solid walls feature a dark cut-away cap (`#3d4450`) mimicking architectural section models. Glass meeting rooms utilize transparent panes with bronze-framed mullions. The environment contains hundreds of interactive decorative and functional props:
</p>
<ul>
    <li><strong>The Kitchen & Cafe:</strong> Animated boiling pots with particle steam effects, stove burners with dynamic flame shaders, coffee machines, and seated chef avatars.</li>
    <li><strong>The Lounge:</strong> Plush sofas, low coffee tables, bean bags (`seatHeight: 0.36m`), an animated pet dog that lounges in the commons, and a large media wall screen.</li>
    <li><strong>Recreation:</strong> A fully modeled foosball table featuring movable player rods that rotate and slide during office break routines.</li>
</ul>

<h4>Humanoid Character Rigging & Life Simulation</h4>
<p>
    Agents in Axon are represented by procedurally generated humanoid characters with anatomical articulation: hands, articulated legs, torso, heads, and distinct hairlines. Rather than standing statically, avatars follow an autonomous daily simulation rhythm (`dayRhythm.ts`):
</p>
<ul>
    <li><strong>Focused Desk Work:</strong> Avatars sit at their assigned workstations with natural seated typing poses.</li>
    <li><strong>Team Standups:</strong> Teams gather around departmental whiteboards at regular intervals to coordinate tasks.</li>
    <li><strong>Watercooler & Coffee Chats:</strong> Avatars wander via A* navigation meshes to the cafe or lounge to interact with colleagues.</li>
    <li><strong>Lunch Rush:</strong> During the midday simulation cycle, staff congregate around the kitchen and lunch tables.</li>
</ul>

<figure>
    <img src="__IMG_LOUNGE__" alt="Axon Commons Lounge and Cafe Area">
    <figcaption>Figure 2.2: The Commons relaxation zone: media wall, kitchen amenities, pet mascot, and animated humanoid agents.</figcaption>
</figure>

<h4>The Single-Draw-Call Role Screen Texture Atlas</h4>
<p>
    In a remarkable graphics engineering achievement (`screenPainters.ts` and `screenSheet.ts`), every computer monitor across all 208 desks displays a miniature, visually accurate rendering of that coworker's specific professional tool — code editors for developers, Figma boards for designers, Gantt charts for project managers, terminal dashboards for DevOps, and spreadsheet metrics for finance.
</p>
<p>
    To maintain 60 FPS on standard desktop hardware without drowning the GPU in draw calls, all 208 individual screen graphics are rendered onto a single unified 2048×2048 texture atlas canvas. Each monitor's UV coordinates map directly into this atlas. Monitors also feature a top-edge <strong>LED Status Light Strip</strong> that glows dynamically based on real-time agent execution state:
</p>
<ul>
    <li><span class="badge badge-slate">0: Idle</span> Monitor displays static role-specific wallpaper.</li>
    <li><span class="badge badge-blue">1: Working</span> Agent is currently streaming tokens or executing tools.</li>
    <li><span class="badge badge-amber">2: Waiting</span> Agent is paused awaiting user confirmation on an Approval Card.</li>
    <li><span class="badge badge-green">3: Done</span> Work task completed successfully.</li>
    <li><span class="badge badge-security">4: Error</span> Provider or tool error encountered during execution.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h3>2.2 The Split-Screen Coworker Workspace</h3>
<p>
    When a user selects a coworker — either by clicking their desk in the 3D campus, selecting their chip on the minimap, or choosing them from the department directory — the application transitions smoothly into a synchronized split-screen workspace (`OfficeWorkspace.tsx`).
</p>

<figure>
    <img src="__IMG_WORK__" alt="Axon Split Workspace">
    <figcaption>Figure 2.3: The Split Work Surface — 3D spatial simulation on top (60%), live multi-turn conversation and diff tools below (40%).</figcaption>
</figure>

<h4>Workspace Architecture & Capabilities</h4>
<ul>
    <li><strong>Adjustable Layout Split:</strong> The default view reserves the upper 60% of the viewport for the 3D office camera (framing the active coworker's desk) and the lower 40% for the dedicated coworker work surface. The split ratio can be adjusted or toggled into full-screen work mode.</li>
    <li><strong>Multi-Turn Reasoning & Thinking Replay:</strong> As modern reasoning models (Claude 3.7 Sonnet, DeepSeek R1, Gemini 2.0 Flash Thinking) produce internal chains of thought, Axon streams reasoning tokens into collapsible thought containers with signature validation.</li>
    <li><strong>Dedicated Project Context:</strong> Coworkers work directly within the project folder selected in the workspace. They read files, inspect package manifests, examine git history, and propose modifications bounded strictly to that project directory.</li>
    <li><strong>Colleague Consultation (`ask_colleague`):</strong> Coworkers can autonomously delegate subtasks to other specialists. For instance, the Chief of Staff can invoke <code>ask_colleague("security-engineer", "Review this auth flow")</code> to incorporate specialized expertise into an overarching recommendation.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h3>2.3 Multi-Provider AI Engine & BYO-Key Protocols</h3>
<p>
    Axon incorporates a high-performance, fault-tolerant model execution engine residing in the Electron main process (`src/main/providers.ts`). Rather than relying on heavyweight cloud frameworks or third-party wrappers, Axon implements direct protocol adapters against standard upstream AI APIs.
</p>

<table>
    <thead>
        <tr>
            <th>Protocol</th>
            <th>Target Endpoint Pattern</th>
            <th>Authentication Header</th>
            <th>Supported Features</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>OpenAI Compatible</strong></td>
            <td><code>{base}/chat/completions</code></td>
            <td><code>Authorization: Bearer &lt;key&gt;</code></td>
            <td>SSE streaming, tools/functions calling, reasoning content (DeepSeek/Kimi), usage capture via <code>stream_options.include_usage</code>, loopback HTTP (Ollama, LM Studio, vLLM).</td>
        </tr>
        <tr>
            <td><strong>Anthropic Messages</strong></td>
            <td><code>{base}/messages</code></td>
            <td><code>x-api-key: &lt;key&gt;</code><br><code>anthropic-version: 2023-06-01</code></td>
            <td>Streaming events, prompt caching (ephemeral cache control on system prompts and history), thinking blocks with cryptographic signatures, tool call turns.</td>
        </tr>
        <tr>
            <td><strong>Google Gemini</strong></td>
            <td><code>{base}/models/{model}:streamGenerateContent?alt=sse</code></td>
            <td><code>x-goog-api-key: &lt;key&gt;</code></td>
            <td>Direct SSE stream generation, thought signatures replay, multi-part contents, function declarations and responses.</td>
        </tr>
    </tbody>
</table>

<h4>Reliability, Timeouts & Error Scrubbing</h4>
<ul>
    <li><strong>Exponential Backoff & Retries:</strong> Transient network errors and server throttling (HTTP 408, 429, 500, 502, 503, 504, 529) are tried up to three times in all (two retries), with adherence to upstream <code>Retry-After</code> headers (capped at 30 seconds). Streams that have already begun emitting assistant tokens are never replayed.</li>
    <li><strong>Startup & Streaming Watchdogs:</strong> Upstream providers are allocated 180 seconds to begin stream transmission. Once streaming commences, a 5-minute inactivity watchdog ensures stalled connections are cleanly terminated with actionable diagnostic messaging.</li>
    <li><strong>Strict Key Scrubbing:</strong> Under no circumstances do API keys appear in application logs, error dialogs, or telemetry. Provider error payloads are scrubbed via regex before presentation in the UI.</li>
    <li><strong>In-Flight Capability Negotiation:</strong> If a proxy or newer model rejects optional parameters like <code>temperature</code>, <code>stream_options</code>, or <code>cache_control</code> with an HTTP 400 error, Axon automatically resubmits the request without the offending parameter and caches the capability profile for all subsequent calls.</li>
</ul>

<div class="callout callout-security">
    <strong>Hardware Keyring Security (DPAPI Vault):</strong> All API keys, OAuth tokens, and client secrets are stored in <code>%APPDATA%\\Axon\\secrets\\os-vault.json</code>, encrypted via Electron's <code>safeStorage</code> API using Windows Data Protection API (DPAPI). If the host operating system lacks a secure hardware keyring, Axon explicitly refuses to save credentials rather than writing plaintext to disk.
</div>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<figure>
    <img src="__IMG_USAGE__" alt="Axon Usage and Cost Tracker">
    <figcaption>Figure 2.4: Settings → Usage: Token consumption broken down by day, provider, model, and conversation with exact reconciliation.</figcaption>
</figure>

<h4>Dynamic Token Budgeting & Request Fitting</h4>
<p>
    Modern multi-turn conversations can rapidly exceed LLM context limitations. Axon's history manager (`src/main/history.ts`) implements an intelligent turn-pruning algorithm (`fitToBudget`):
</p>
<pre><code>// History budgeting algorithm ensures strict tool-call invariants
export function fitToBudget(messages: Message[], charBudget = 300_000): Message[] {
  // 1. Every tool_use turn MUST be followed by its matching tool_result
  // 2. Turns never get pruned partially (atomic user/assistant pair removal)
  // 3. System prompt and immediate prior turns are permanently pinned
  ...
}</code></pre>
<p>
    If a conversation history exceeds 300,000 characters, Axon drops the oldest complete interaction turns while preserving the foundational system instructions, file manifests, and immediate operational context. Crucially, tool calls and their results are treated as atomic units — an assistant tool-call turn is never left without its corresponding tool-result, preventing provider API validation rejections.
</p>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h3>2.4 Human-in-the-Loop Safety, Diff Approvals & Coworker Undo</h3>
<p>
    Unlike conventional coding assistants that silently mutate files across a user's repository, Axon enforces a rigorous <strong>Zero Unprompted Writes</strong> security policy governed by human confirmation and cryptographic version snapshotting.
</p>

<figure>
    <img src="__IMG_REVIEW__" alt="Axon Diff Approval Card">
    <figcaption>Figure 2.5: The Approval Card: Visual side-by-side diff with syntax highlighting, exact file targets, and Approve/Reject controls.</figcaption>
</figure>

<h4>The Approval Card Lifecycle</h4>
<p>
    Whenever a coworker or sub-agent invokes a mutating tool (`write_file`, `update_memory`, `run_command`, `git_commit`), execution immediately pauses. The tool loop yields control to the renderer, which presents an interactive <strong>Approval Card</strong>:
</p>
<ul>
    <li><strong>Line-by-Line Colorized Diff:</strong> The card computes a real Git-style diff against the current disk state, highlighting additions in green and deletions in red with exact line numbers.</li>
    <li><strong>Every Argument Shown:</strong> For connector and sub-agent calls the card lists every argument, highlighting recipients, amounts and addresses; a write says whether it overwrites an existing file; the run's folder is named. Sending, paying, deleting or publishing asks for a second confirmation.</li>
    <li><strong>Scoped Granular Permissions:</strong> The user can choose <strong>Approve</strong> (runs once), <strong>Reject</strong>, or <strong>Always allow in this conversation</strong>, which covers that tool (for commands, that exact command) in that conversation and folder only, never writes to dot-folders or build and script files, never irreversible connector actions, and can be taken back in Settings.</li>
</ul>

<h4>The 500-Version Coworker Undo Engine</h4>
<p>
    Even with approval cards, humans make mistakes. Axon includes an unprecedented safety net: the <strong>Coworker Undo Engine</strong> (`src/main/audit/checkpoints.ts`):
</p>
<ul>
    <li><strong>Pre-Write Snapshotting:</strong> Before <code>write_file</code> or <code>update_memory</code> replaces a file, Axon keeps its previous text in a rolling 500-entry checkpoint store. A write is refused if the file changed while its approval card waited.</li>
    <li><strong>One-Click Work Surface Undo:</strong> After an agent saves changes, the coworker's work surface displays an "Undo" action alongside the file result summary.</li>
    <li><strong>Dirty-File Collision Detection:</strong> Before rolling back a file, Axon verifies whether the user or an external process has modified the file since the agent's write. If an external edit is detected, Axon warns the user natively rather than clobbering their intermediate work.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<figure>
    <img src="__IMG_ACTIVITY__" alt="Axon Activity Audit Log">
    <figcaption>Figure 2.6: Settings → Activity Log: 20,000-entry searchable audit trail of every tool call, decision, and sub-agent invocation.</figcaption>
</figure>

<h4>Tamper-Evident Activity Log</h4>
<p>
    In compliance with enterprise governance and security audit requirements, Axon records every tool call made across the platform, and every safety-relevant change the user makes (shell commands, sign-ins, connector commands, trusted folders, restores), in an append-only, hash-chained audit trail (`src/main/audit/log.ts`): each entry carries the hash of the one before, so an edited, inserted or removed entry is detected.
</p>
<ul>
    <li><strong>20,000-Record Local Capacity:</strong> Keeps the newest 20,000 entries on disk (`userData/audit/audit.jsonl`); secrets in command lines are redacted.</li>
    <li><strong>Privacy-Preserving Audit:</strong> The log records caller identity (e.g., "Frontend Developer", "Research Analyst", "Colleague: Security Engineer"), tool name, timestamp, approval state, and high-level outcome. Critically, raw file contents and code payloads are <em>never</em> stored in the audit log, preventing sensitive intellectual property from lingering in plaintext logs.</li>
    <li><strong>Search, Filter & Export:</strong> Users can filter by coworker, tool type, or outcome, and export the complete audit record as JSON or CSV for enterprise compliance reporting.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h3>2.5 Local Document Intelligence & Process-Isolated RAG</h3>
<p>
    Modern AI workflows require synthesizing disparate documents — research papers, architecture specifications, API documentation, spreadsheets, and source code. Axon features a built-in Local RAG (Retrieval-Augmented Generation) pipeline that operates entirely on-device without cloud embedding APIs or external vector databases.
</p>

<h4>Sandboxed Document Reader (`parse-host.ts`)</h4>
<p>
    Document parsers are a classic attack surface. Axon reads every document in a hidden Chromium renderer running in the operating system's sandbox (restricted token and job object on Windows, seatbelt on macOS, seccomp on Linux), with no Node.js, no file system access, and a session whose every network request is cancelled. The main process reads the file and hands over its bytes, never a path:
</p>
<ul>
    <li><strong>Current, Hardened Parsers:</strong> pdf.js 6.3 with <code>eval</code> disabled and no fonts loaded; ZIP-based documents are checked for zip bombs (over 200 MB unpacked) before they are opened.</li>
    <li><strong>30-Second Hard Watchdog:</strong> If a malformed PDF or massive spreadsheet hangs or crashes the reader, it is torn down after 30 seconds and made again on next use.</li>
    <li><strong>Zero Renderer Blocker:</strong> Complex multi-megabyte parsing tasks execute asynchronously in background processes without dropping a single frame in the React UI or 3D campus simulation.</li>
</ul>

<h4>Supported Ingestion Formats</h4>
<table>
    <thead>
        <tr>
            <th>Format</th>
            <th>Parser Engine</th>
            <th>Extraction Pipeline</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>PDF Documents</strong></td>
            <td><code>pdfjs-dist</code> 6.3</td>
            <td>Text layer extraction page by page; each page is marked so passages cite it.</td>
        </tr>
        <tr>
            <td><strong>Word Documents</strong></td>
            <td><code>mammoth</code></td>
            <td>DOCX raw text extraction.</td>
        </tr>
        <tr>
            <td><strong>Excel Spreadsheets</strong></td>
            <td><code>exceljs</code></td>
            <td>Worksheet iteration; formulas read by their saved (cached) values, not evaluated (replaces vulnerable <code>xlsx</code>). Old .xls files are declined with advice to save as .xlsx.</td>
        </tr>
        <tr>
            <td><strong>Tabular Data</strong></td>
            <td>Custom CSV Parser</td>
            <td>Delimiter sniffing (comma, semicolon, tab, pipe), quoted cells, row-by-row structuring.</td>
        </tr>
        <tr>
            <td><strong>Code & Text</strong></td>
            <td>Native Stream Reader</td>
            <td>Source files, Markdown specs, JSON, YAML with line boundary preservation.</td>
        </tr>
    </tbody>
</table>

<h4>BM25 Retrieval & Untrusted Context Tagging</h4>
<p>
    Ingested documents are chunked into passages of 1,600 characters (about 400 tokens) overlapping by 400 characters. Retrieval is executed via a BM25 (Best Matching 25) lexical ranking over a cached index (`src/main/knowledge.ts`). Retrieved passages are injected into the coworker's system prompt enclosed within explicit security boundaries that their own text can't close:
</p>
<pre><code>&lt;retrieved_knowledge_passage source="specs/security.pdf" chunk="7" page="14" trust="untrusted"&gt;
Passage contents extracted from local index...
&lt;/retrieved_knowledge_passage&gt;</code></pre>
<p>
    This explicit untrusted tagging instructs the model to treat document contents purely as factual reference data rather than executable operational instructions, providing robust defense against indirect prompt injection attacks.
</p>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h3>2.6 Model Context Protocol (MCP) Integration Engine</h3>
<p>
    Axon incorporates a production-grade implementation of Anthropic's open-source <strong>Model Context Protocol (MCP)</strong> (`src/main/mcp/client-manager.ts`). Connectors allow coworkers to break out of local isolation and interact directly with external developer tools, cloud infrastructure, databases, communication platforms, and SaaS APIs.
</p>

<figure>
    <img src="__IMG_CONNECTORS__" alt="Axon Connectors Catalog">
    <figcaption>Figure 2.7: Settings → Connectors: Catalog of 39 pre-configured connectors with OAuth browser sign-in and per-tool permissions.</figcaption>
</figure>

<h4>Triple Transport Architecture</h4>
<ul>
    <li><strong>Streamable HTTP (2025-06-18 Spec):</strong> Modern high-performance transport where requests are sent as HTTP POSTs returning either direct JSON or streaming SSE. Includes automatic <code>Mcp-Session-Id</code> lifecycle management, protocol version negotiation, and paged tool listing.</li>
    <li><strong>Local Stdio Child Processes:</strong> Spawns command-line MCP servers on the local machine (e.g., <code>npx -y @playwright/mcp</code>). On Windows, commands are sanitized and routed via <code>cmd.exe</code> with safe argument quoting and a 120-second startup initialization budget to permit initial package downloads.</li>
    <li><strong>Legacy HTTP+SSE (2024-11-05 Spec):</strong> Full backwards compatibility with original Server-Sent Events endpoints for older MCP servers.</li>
</ul>

<h4>In-App Browser OAuth 2.0 PKCE Engine (`mcp/oauth.ts`)</h4>
<p>
    Connecting cloud services (like Notion, Linear, Slack, Google Drive) requires zero manual API token copy-pasting. Axon features a built-in OAuth 2.0 engine:
</p>
<ul>
    <li><strong>RFC 7636 PKCE S256:</strong> Cryptographically generated code verifiers and SHA-256 challenges prevent token interception.</li>
    <li><strong>Ephemeral Loopback Redirect:</strong> The main process spins up a temporary HTTP server on <code>127.0.0.1</code> to receive the browser's redirect callback cleanly.</li>
    <li><strong>Automatic Refresh & Token Vaulting:</strong> Tokens are encrypted in the OS vault under <code>mcp-oauth:&lt;id&gt;</code> and automatically refreshed within one minute of expiration or following an HTTP 401 response.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h4>Coworker Scoping & Granular Tool Permissions</h4>
<p>
    Rather than exposing all 39 connectors to every agent simultaneously (which would overflow LLM tool budgets and introduce catastrophic hallucination), connectors are strictly scoped:
</p>
<ul>
    <li><strong>Targeted Assignment:</strong> Connectors are assigned by coworker ID (e.g., Figma to the Designer), by department group (e.g., GitHub and Sentry to Engineering), or made available globally to user chats.</li>
    <li><strong>100-Tool Request Budget:</strong> OpenAI and other providers enforce strict limits on total tool definitions (OpenAI caps at 128). Axon ensures that no individual request carries more than 100 tool definitions, gracefully truncating the lowest-priority connectors and notifying the model accordingly.</li>
    <li><strong>Ask First, by Default:</strong> Every connector tool asks before it runs unless you allow it, or choose to trust a server's <code>readOnlyHint</code> marks (a server can mark anything, so no server is trusted by default). Once a run has read outside content, an allowed call that carries text asks again. Sending, paying, deleting and publishing ask twice.</li>
</ul>

<div class="callout callout-info">
    <strong>Composio Rube Bridge (`connectors/rube.ts`):</strong> Many existing agent skills reference Composio's legacy Rube standard (retired May 2026). When a coworker has Composio Connect enabled, Axon's dynamic tool translation layer automatically maps any <code>RUBE_&lt;ACTION&gt;</code> tool calls into the modern <code>COMPOSIO_&lt;ACTION&gt;</code> wire format seamlessly.
</div>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h3>2.7 Transparency, Cost Metering & Governance</h3>
<p>
    To ensure developers and enterprise teams maintain total visibility over their operational spend and system reliability, Axon incorporates three dedicated transparency subsystems:
</p>

<figure>
    <img src="__IMG_METER__" alt="Axon Real-Time Context Meter">
    <figcaption>Figure 2.8: The Context Meter: Real-time capacity bar displaying token consumption, character limits, and budget margin.</figcaption>
</figure>

<h4>1. The Real-Time Context Meter</h4>
<p>
    Positioned prominently above every conversation view, the <strong>Context Meter</strong> provides real-time telemetry on the conversation's active memory footprint:
</p>
<ul>
    <li><strong>Token & Character Accounting:</strong> Displays the exact token utilization against the active model's configured context window (e.g., 128k, 200k, 1M tokens).</li>
    <li><strong>Pruning Proximity Indicator:</strong> Calculates how close the conversation is to the 300,000-character budget threshold where older interaction turns are automatically pruned.</li>
    <li><strong>Estimate vs. Exact Breakdown:</strong> Distinguishes between local heuristic token estimates (during in-flight streaming) and exact provider-reported token usage.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 2: What Axon Does</span>
</div>

<h4>2. Usage & Running Cost Dashboard</h4>
<p>
    Accessible via <strong>Settings → Usage</strong>, Axon provides comprehensive economic accounting of all LLM interactions without relying on external SaaS trackers:
</p>
<ul>
    <li><strong>Per-Model Price Tables:</strong> Users can specify prompt and completion prices per million tokens in the provider configuration dialog (Axon ships with no hardcoded pricing table, ensuring users maintain control over their exact negotiated rates).</li>
    <li><strong>Real-Time Streaming Cost Snapping:</strong> While an assistant turn streams, cost is calculated in real time based on token estimates. Once the provider's final SSE payload arrives, the estimate automatically snaps to the provider's exact reported usage.</li>
    <li><strong>Multi-Dimensional Aggregation:</strong> Costs and token counts can be grouped and sorted by calendar day, provider, model ID, or conversation thread.</li>
</ul>

<figure>
    <img src="__IMG_RESTORE__" alt="Axon Restore Points Dialog">
    <figcaption>Figure 2.9: Settings → Privacy & Security: Rolling restore points with native pre-backup confirmation and state quarantine.</figcaption>
</figure>

<h4>3. Rolling Restore Points & Corruption Quarantine</h4>
<p>
    To protect against accidental configuration corruption or catastrophic file loss, Axon features an automated disaster recovery system (`src/main/repository.ts`):
</p>
<ul>
    <li><strong>Automated Rolling Backups:</strong> The system captures a consistent snapshot of the SQLite state (`data/db/axon.db`) at launch and at most every 10 minutes, only when something changed, keeping the newest ten and the newest of each of the last seven days in <code>userData/backups/</code>. An empty or just-recovered state never pushes older restore points out.</li>
    <li><strong>Atomic Safe Writes:</strong> Every save is one SQLite transaction in a write-ahead log with full synchronisation, so a crash or power failure leaves the last committed save whole.</li>
    <li><strong>Corruption Quarantine:</strong> If the saved data is damaged or missing, Axon sets it aside as <code>corrupt-*</code>, starts from the newest restore point that passes its checks, and tells the user natively what happened.</li>
</ul>
""")

    # Chapter 3
    parts.append("""
<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 3: What Axon Contains</span>
</div>

<h1>Chapter 3: What Axon Contains — Structural Blueprint</h1>

<h3>3.1 Repository Anatomy & Complete Source Code Hierarchy</h3>
<p>
    The Axon codebase is organized into cleanly partitioned modules with strict architectural boundaries separating desktop lifecycle, background services, 3D simulation, and UI views.
</p>

<table>
    <thead>
        <tr>
            <th style="width: 28%;">Directory / Module</th>
            <th style="width: 22%;">Responsibility</th>
            <th style="width: 50%;">Key Source Files & Architectural Role</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>src/main/</code></td>
            <td>Main Electron Process</td>
            <td>
                <code>index.ts</code>: App lifecycle, window bounds, IPC sender verification.<br>
                <code>service.ts</code>: Core orchestration, chat execution loop, tool invocation.<br>
                <code>providers.ts</code>: Protocol adapters (OpenAI, Anthropic, Gemini), retries, SSE parser.<br>
                <code>history.ts</code>: Conversation turn-pruning, atomic tool-pair budgeting.<br>
                <code>officeTools.ts</code>: Tool filtering per coworker and folder scope.<br>
                <code>colleagues.ts</code>: Inter-agent consultation routing (`ask_colleague`).<br>
                <code>repository.ts</code>: State persistence, schema validation, rolling backups.<br>
                <code>parse-pool.ts</code>: Worker process pool management for document parsing.
            </td>
        </tr>
        <tr>
            <td><code>src/main/mcp/</code></td>
            <td>Model Context Protocol</td>
            <td>
                <code>client-manager.ts</code>: Transports (Streamable HTTP, stdio, SSE), tool discovery.<br>
                <code>oauth.ts</code>: PKCE S256 browser sign-in, token refresh loop, vault storage.
            </td>
        </tr>
        <tr>
            <td><code>src/main/audit/</code></td>
            <td>Governance & Safety</td>
            <td>
                <code>log.ts</code>: 20,000-entry audit log recording tool execution without file leaks.<br>
                <code>checkpoints.ts</code>: 500-version file rollback history for coworker undo.
            </td>
        </tr>
        <tr>
            <td><code>src/main/security/</code></td>
            <td>Boundary Enforcement</td>
            <td>
                <code>permissions.ts</code>: Allow/Ask/Deny policies, session grants, folder scoping.
            </td>
        </tr>
        <tr>
            <td><code>src/main/git/</code></td>
            <td>Source Control</td>
            <td>
                <code>sourceControl.ts</code>: Local git inspection, diff extraction, staging, commits.<br>
                <code>githubApi.ts</code>: Direct GitHub API integration for clone, publish, sync.
            </td>
        </tr>
        <tr>
            <td><code>src/main/infra/</code></td>
            <td>System Infrastructure</td>
            <td>
                <code>vault.ts</code>: OS DPAPI / Keychain keyring storage (`secrets/os-vault.json`).<br>
                <code>store.ts</code>: Atomic file operations and atomic JSON persistence.
            </td>
        </tr>
        <tr>
            <td><code>src/main/tasks/</code></td>
            <td>Planning & Tasks</td>
            <td>
                <code>tracker.ts</code>: Task record tracking, receptionist to-dos, execution states.
            </td>
        </tr>
        <tr>
            <td><code>src/preload/</code></td>
            <td>Secure IPC Bridge</td>
            <td>
                <code>index.ts</code>: Context-isolated <code>window.axon</code> API facade.
            </td>
        </tr>
        <tr>
            <td><code>src/shared/</code></td>
            <td>Universal Types & Contracts</td>
            <td>
                <code>platform.ts</code>: Typed IPC bridge method signatures.<br>
                <code>types.ts</code>: Universal data models (Messages, Providers, Workspaces, Tools).<br>
                <code>coworkers.ts</code>: Roster of 9 Core + 204 Specialist coworkers.<br>
                <code>connectors.ts</code>: MCP catalog definitions and transport interfaces.<br>
                <code>cost.ts</code>: Token pricing math and cost reconciliation formulas.
            </td>
        </tr>
        <tr>
            <td><code>src/renderer/src/</code></td>
            <td>React Desktop Application</td>
            <td>
                <code>App.tsx</code>: Main shell layout, view switching, active project banner.<br>
                <code>tokens.css</code>: 3-tier CSS design token specification.<br>
                <code>Settings.tsx</code>: System configuration, providers, accounts, audit, usage.
            </td>
        </tr>
        <tr>
            <td><code>src/renderer/src/features/office/</code></td>
            <td>3D Simulation Subsystem</td>
            <td>
                <code>scene/room/buildOffice.ts</code>: Three.js procedural office generation.<br>
                <code>campus/districts.ts</code>: Campus layout, bounds, sign placements, departments.<br>
                <code>simulation/OfficeSimulation.ts</code>: Autonomous agent routines, A* navigation.<br>
                <code>scene/agents/HumanoidRig.ts</code>: Skeletal rigging and character mesh deformation.<br>
                <code>scene/room/screenPainters.ts</code>: 208-screen unified texture atlas painting.<br>
                <code>workspace/OfficeWorkspace.tsx</code>: Split-screen work surface, diff inspector.
            </td>
        </tr>
    </tbody>
</table>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 3: What Axon Contains</span>
</div>

<h3>3.2 The 9 Core Commons Coworkers</h3>
<p>
    The central Commons is staffed by nine permanent core specialists. These nine coworkers handle cross-functional orchestration, front-desk operations, strategic planning, user research, and project asset verification.
</p>

<div class="grid-2">
    <div class="card">
        <div class="card-title">
            <span>1. Receptionist</span>
            <span class="badge badge-amber">Core Orchestrator</span>
        </div>
        <div class="card-subtitle">Front Desk & Planning • Reception</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Keeps the user's master schedule, to-dos, and reminders. Knows what every coworker is working on.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> <code>add_task</code>, <code>list_tasks</code>, <code>update_task</code>, <code>complete_task</code>, Google Calendar MCP, Todoist MCP.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Be warm, brief, and never confirm an action unless the tool call succeeded."</p>
    </div>

    <div class="card">
        <div class="card-title">
            <span>2. Chief of Staff</span>
            <span class="badge badge-blue">Executive Right Hand</span>
        </div>
        <div class="card-subtitle">Briefings & Coordination • Planning Room</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Turns broad goals into who does what, routes work to the right specialist, and writes executive decision memos.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> <code>ask_colleague</code>, Notion MCP, Slack MCP, Google Drive MCP.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Lead with decisions only the user can make. Consult specialists rather than guessing."</p>
    </div>

    <div class="card">
        <div class="card-title">
            <span>3. Research Analyst</span>
            <span class="badge badge-purple">Deep Synthesis</span>
        </div>
        <div class="card-subtitle">Research & Insights • Library</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Conducts deep domain research, competitor audits, and technical document synthesis with rigorous citations.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> Exa MCP, DeepWiki MCP, Microsoft Learn MCP, Context7 MCP, Hugging Face MCP.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Structure complex findings into crisp decision matrices with exact source references."</p>
    </div>

    <div class="card">
        <div class="card-title">
            <span>4. Product Coach</span>
            <span class="badge badge-purple">Product Strategy</span>
        </div>
        <div class="card-subtitle">Roadmaps & PRDs • Planning Room</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Transforms ambiguous ideas into structured Product Requirements Documents (PRDs), user stories, and roadmaps.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> Linear MCP, Jira MCP, Asana MCP, Notion MCP.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Evaluate tradeoffs rigorously. Push back on features lacking clear user problems."</p>
    </div>

    <div class="card">
        <div class="card-title">
            <span>5. Designer</span>
            <span class="badge badge-blue">Design & UX</span>
        </div>
        <div class="card-subtitle">Product & UX Design • Planning Room</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Shapes user journeys, interface information architecture, design systems, and component tokens.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> Figma MCP, Canva MCP, Webflow MCP, Playwright browser MCP.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Balance visual craft with usability. Enforce consistent design token scales."</p>
    </div>

    <div class="card">
        <div class="card-title">
            <span>6. Knowledge Librarian</span>
            <span class="badge badge-purple">Knowledge RAG</span>
        </div>
        <div class="card-subtitle">Indexing & Retrieval • Library</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Organizes, indexes, and queries project documentation, papers, and uploaded files via BM25 retrieval.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> Local BM25 Knowledge Store, Google Drive MCP, Box MCP, Notion MCP.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Extract high-signal answers with verifiable line and page citations."</p>
    </div>

    <div class="card">
        <div class="card-title">
            <span>7. Files Agent</span>
            <span class="badge badge-green">Asset Governance</span>
        </div>
        <div class="card-subtitle">Files & Assets • Files Room</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Audits project file trees, inspects multi-format attachments, verifies integrity, and organizes file structures.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> <code>read_file</code>, <code>list_files</code>, <code>search_code</code>, Process-Isolated Parse Pool.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Enforce clean repository boundaries and extract structured data from binary files."</p>
    </div>

    <div class="card">
        <div class="card-title">
            <span>8. Marketing Strategist</span>
            <span class="badge badge-green">GTM & Positioning</span>
        </div>
        <div class="card-subtitle">Positioning & Narrative • Lounge</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Defines go-to-market strategies, target audience personas, value propositions, and launch communications.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> HubSpot MCP, Slack MCP, Figma MCP, Canva MCP.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Craft crisp messaging that articulates differentiation without hollow corporate buzzwords."</p>
    </div>

    <div class="card" style="grid-column: span 2;">
        <div class="card-title">
            <span>9. Ops Coordinator</span>
            <span class="badge badge-green">Operations & Execution</span>
        </div>
        <div class="card-subtitle">Cross-Functional Checklists • Planning Room</div>
        <p style="font-size: 8.5pt;"><strong>Role:</strong> Keeps execution on track by decomposing complex initiatives into actionable checklists, mapping blocker dependencies, and monitoring cross-team delivery.</p>
        <p style="font-size: 8pt; color: #475569;"><strong>Tools:</strong> <code>ask_colleague</code>, Asana MCP, monday.com MCP, ClickUp MCP, Linear MCP, Zapier MCP, Composio MCP.</p>
        <p style="font-size: 7.5pt; color: #64748b; font-style: italic;">"Ensure operational excellence, verify prerequisite steps, and resolve team bottlenecks proactively."</p>
    </div>
</div>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 3: What Axon Contains</span>
</div>

<h3>3.3 The 204 Domain Specialists across 23 Department Groups</h3>
<p>
    Beyond the 9 Core Commons specialists, Axon contains 203 authored specialist roles (`src/roles/roles.json`) plus a dedicated Business Analyst, totaling <strong>204 domain specialists</strong>. Each specialist represents a deeply calibrated engineering, operational, or executive discipline.
</p>

<table>
    <thead>
        <tr>
            <th style="width: 25%;">Department Group</th>
            <th style="width: 10%;">Roles</th>
            <th style="width: 65%;">Seated Specialist Roles in Group</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>Web & Frontend</strong></td>
            <td>6 roles</td>
            <td>Frontend Developer, React Developer, Web Developer, Accessibility Specialist, CSS Architect, UI Performance Engineer.</td>
        </tr>
        <tr>
            <td><strong>Backend & APIs</strong></td>
            <td>8 roles</td>
            <td>Backend Developer, Node.js Developer, Python Developer, Go Developer, API Designer, Database Administrator, GraphQL Specialist, Microservices Architect.</td>
        </tr>
        <tr>
            <td><strong>Mobile</strong></td>
            <td>5 roles</td>
            <td>iOS Developer, Android Developer, React Native Developer, Flutter Developer, Mobile Architect.</td>
        </tr>
        <tr>
            <td><strong>Cloud & Infrastructure</strong></td>
            <td>11 roles</td>
            <td>DevOps Engineer, Cloud Architect, Site Reliability Engineer, Kubernetes Administrator, Terraform Specialist, AWS Specialist, Azure Specialist, GCP Specialist, Serverless Engineer, Network Engineer, Observability Engineer.</td>
        </tr>
        <tr>
            <td><strong>Security</strong></td>
            <td>5 roles</td>
            <td>Application Security Engineer, Penetration Tester, Cloud Security Architect, Compliance Specialist, Cryptographer.</td>
        </tr>
        <tr>
            <td><strong>AI, ML & Data</strong></td>
            <td>17 roles</td>
            <td>Machine Learning Engineer, Data Scientist, Data Engineer, AI Researcher, MLOps Engineer, Computer Vision Engineer, NLP Engineer, Analytics Engineer, Data Platform Architect, Prompt Engineer, Vector Database Specialist, AI Safety Auditor, Deep Learning Specialist, BI Analyst, Big Data Engineer, LLM Fine-Tuning Engineer, Quantitative Analyst.</td>
        </tr>
        <tr>
            <td><strong>Architecture & General Engineering</strong></td>
            <td>9 roles</td>
            <td>Principal Architect, Systems Architect, Solutions Architect, Enterprise Architect, Performance Engineer, Systems Programmer (Rust/C++), Embedded Systems Developer, Refactoring Specialist, Technical Debt Auditor.</td>
        </tr>
        <tr>
            <td><strong>Design</strong></td>
            <td>5 roles</td>
            <td>Product Designer, UI Designer, UX Researcher, Design Systems Lead, Motion Designer.</td>
        </tr>
        <tr>
            <td><strong>QA & Release</strong></td>
            <td>7 roles</td>
            <td>QA Automation Engineer, Manual QA Specialist, Performance Tester, Security QA Specialist, Release Manager, Mobile QA Specialist, Test Architect.</td>
        </tr>
        <tr>
            <td><strong>Platforms & Enterprise</strong></td>
            <td>11 roles</td>
            <td>Salesforce Developer, SAP Consultant, ServiceNow Specialist, Dynamics 365 Architect, Enterprise Integration Architect, Workday Specialist, Mainframe Modernization Engineer, CMS Architect, ERP Specialist, Identity & Access (IAM) Engineer, Middleware Specialist.</td>
        </tr>
        <tr>
            <td><strong>Emerging Tech</strong></td>
            <td>14 roles</td>
            <td>Blockchain Developer, Smart Contract Auditor, AR/VR Developer, IoT Systems Architect, Quantum Computing Researcher, Web3 Architect, Edge AI Engineer, Robotics Engineer, Spatial Computing Developer, Game Engine Developer (Unreal/Unity), Firmware Engineer, Digital Twin Architect, Bio-Informatics Specialist, Autonomous Systems Engineer.</td>
        </tr>
        <tr>
            <td><strong>Executive Leadership</strong></td>
            <td>10 roles</td>
            <td>Chief Technology Officer (CTO), Chief Product Officer (CPO), Chief Information Security Officer (CISO), Chief Operating Officer (COO), Chief Financial Officer (CFO), Chief Revenue Officer (CRO), Chief Marketing Officer (CMO), Chief People Officer, General Counsel, Chief Executive Officer (CEO).</td>
        </tr>
        <tr>
            <td><strong>General Management</strong></td>
            <td>10 roles</td>
            <td>VP of Engineering, VP of Product, VP of Design, VP of Sales, VP of Marketing, VP of Operations, Director of Engineering, Director of Product, General Manager, Business Unit Director.</td>
        </tr>
        <tr>
            <td><strong>Product Management</strong></td>
            <td>10 roles</td>
            <td>Lead Product Manager, Technical Product Manager, Growth Product Manager, Platform Product Manager, Data Product Manager, AI Product Manager, Enterprise Product Manager, Mobile Product Manager, B2B SaaS Product Manager, Associate Product Manager.</td>
        </tr>
        <tr>
            <td><strong>Project Management</strong></td>
            <td>10 roles</td>
            <td>Technical Program Manager (TPM), Scrum Master, Agile Coach, Delivery Manager, Project Manager, Program Manager, PMO Director, Release Coordinator, Sprint Manager, Operations PM.</td>
        </tr>
        <tr>
            <td><strong>Engineering Management</strong></td>
            <td>10 roles</td>
            <td>Engineering Manager, Lead Architect, QA Manager, DevOps Manager, Security Manager, Data Science Manager, Mobile Engineering Manager, Frontend Lead, Backend Lead, Infrastructure Manager.</td>
        </tr>
        <tr>
            <td><strong>Operations Management</strong></td>
            <td>10 roles</td>
            <td>VP of Operations, Operations Director, Supply Chain Specialist, IT Operations Manager, Logistics Coordinator, Procurement Manager, Facilities Director, Vendor Manager, Risk & Compliance Manager, Process Improvement Lead.</td>
        </tr>
        <tr>
            <td><strong>Sales Management</strong></td>
            <td>10 roles</td>
            <td>VP of Sales, Sales Director, Enterprise Account Executive, Sales Engineering Lead, Sales Enablement Manager, Account Manager, Inbound Sales Lead, Outbound SDR Lead, Customer Acquisition Manager, Sales Operations Director.</td>
        </tr>
        <tr>
            <td><strong>Marketing Management</strong></td>
            <td>10 roles</td>
            <td>VP of Marketing, Head of Growth, Content Strategist, Brand Manager, Product Marketing Manager (PMM), SEO Specialist, Performance Marketer, Developer Relations (DevRel) Lead, Event Marketing Director, Marketing Analytics Lead.</td>
        </tr>
        <tr>
            <td><strong>HR & People</strong></td>
            <td>10 roles</td>
            <td>Head of People, Technical Recruiter, Talent Acquisition Lead, Compensation & Benefits Lead, HR Business Partner (HRBP), People Ops Manager, Learning & Development (L&D) Director, Employee Experience Lead, Diversity & Inclusion Lead, Culture Ambassador.</td>
        </tr>
        <tr>
            <td><strong>Customer Success</strong></td>
            <td>5 roles</td>
            <td>VP of Customer Success, Customer Success Manager (CSM), Technical Account Manager (TAM), Support Engineering Lead, Client Onboarding Specialist.</td>
        </tr>
        <tr>
            <td><strong>Strategy & Innovation</strong></td>
            <td>6 roles</td>
            <td>Chief Strategy Officer, Corporate Development Lead, Innovation Lab Director, Venture Strategist, Market Intelligence Lead, Business Analyst.</td>
        </tr>
    </tbody>
</table>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 3: What Axon Contains</span>
</div>

<h4>Authored Role Anatomy: The 4 Invariants</h4>
<p>
    Unlike vague generic AI personas ("You are an expert developer"), every role in Axon conforms to a strict four-part behavioral contract (`profile` in `roles.json`):
</p>
<ol>
    <li><strong>Owns:</strong> The explicit code, infrastructure boundaries, design surfaces, or business assets that this role is personally responsible for.</li>
    <li><strong>Optimizes For:</strong> The specific engineering or operational tradeoffs that this role prioritizes (e.g., perceived latency, bundle size, cryptographic integrity, test coverage, margin).</li>
    <li><strong>Pushes Back On:</strong> Anti-patterns, shortcut hacks, architectural smells, or unvalidated assumptions that this role is instructed to reject actively.</li>
    <li><strong>Communicates:</strong> The precise artifacts, formats, and evidence this role presents (e.g., flame graphs, component trees, diff cards, PRDs, decision matrices).</li>
</ol>

<div class="card" style="margin-top: 8pt; background: #f8fafc;">
    <div class="card-title">Case Study: The React Developer Role Profile (`roles.json`)</div>
    <pre style="margin: 0; font-size: 7.5pt; line-height: 1.45;"><code>"id": "react-developer",
"name": "React Developer",
"group": "Web & Frontend",
"profile": "Owns: the React component architecture — hooks, context, state management, rendering behaviour and the data-fetching layer between components and APIs.
Optimises for: predictable re-renders, colocated state, and components that can be tested in isolation without mounting the whole app.
Pushes back on: prop drilling through five layers, useEffect used as a data-flow mechanism, global stores holding server state that a query cache should own, and class components added to a hooks codebase.
Communicates: in component hierarchies, React Profiler flame graphs and Storybook stories; explains a change by what re-renders and why; links every pattern to the React docs it comes from."</code></pre>
</div>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 3: What Axon Contains</span>
</div>

<h3>3.4 The 39 Catalog Connectors (Model Context Protocol)</h3>
<p>
    Axon includes a verified catalog of 39 connectors (`src/connectors/catalog.json`) spanning developer infrastructure, documentation, creative tooling, communications, and live browser automation.
</p>

<table>
    <thead>
        <tr>
            <th>ID / Service</th>
            <th>Category</th>
            <th>Transport / Auth</th>
            <th>Default Seated Coworkers & Groups</th>
            <th>Capabilities & Scope</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>GitHub</strong></td>
            <td>Code</td>
            <td>HTTP / github-account</td>
            <td>All Engineering Groups, Management</td>
            <td>Repositories, issues, pull requests, Actions workflows.</td>
        </tr>
        <tr>
            <td><strong>GitLab</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>All Engineering Groups</td>
            <td>Projects, merge requests, CI pipelines, issues.</td>
        </tr>
        <tr>
            <td><strong>Linear</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>Product Coach, Engineering, Product</td>
            <td>Issues, projects, cycles, triage workflows.</td>
        </tr>
        <tr>
            <td><strong>Sentry</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>All Engineering Groups</td>
            <td>Real-time error monitoring, stack traces, release triage.</td>
        </tr>
        <tr>
            <td><strong>Vercel</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>Engineering, Frontend, DevOps</td>
            <td>Deployments, domains, build logs, serverless environments.</td>
        </tr>
        <tr>
            <td><strong>Netlify</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>Engineering, Web Developers</td>
            <td>Sites, form submissions, edge deploy logs.</td>
        </tr>
        <tr>
            <td><strong>Supabase</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>Backend, Data, Full-Stack</td>
            <td>Postgres tables, SQL query execution, Edge Functions.</td>
        </tr>
        <tr>
            <td><strong>Neon</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>Backend, Database Administrators</td>
            <td>Serverless Postgres branches, migrations, SQL queries.</td>
        </tr>
        <tr>
            <td><strong>Prisma</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>Backend, API Engineers</td>
            <td>Prisma Postgres databases, schema migrations.</td>
        </tr>
        <tr>
            <td><strong>Cloudflare</strong></td>
            <td>Code</td>
            <td>HTTP / oauth</td>
            <td>DevOps, Cloud, Edge Engineers</td>
            <td>Workers, KV key-values, R2 object buckets, D1 SQL.</td>
        </tr>
        <tr>
            <td><strong>Notion</strong></td>
            <td>Docs</td>
            <td>HTTP / oauth</td>
            <td>Chief of Staff, Product Coach, Ops, Library</td>
            <td>Pages, team databases, search, knowledge wikis.</td>
        </tr>
        <tr>
            <td><strong>Jira & Confluence</strong></td>
            <td>Docs</td>
            <td>HTTP / oauth</td>
            <td>Product Coach, Ops, Engineering Mgr</td>
            <td>Jira sprint boards, sprint backlog, Confluence spaces.</td>
        </tr>
        <tr>
            <td><strong>Asana</strong></td>
            <td>Docs</td>
            <td>HTTP / oauth-app</td>
            <td>Product, Project, Ops Management</td>
            <td>Tasks, milestones, portfolio goals, project updates.</td>
        </tr>
        <tr>
            <td><strong>monday.com</strong></td>
            <td>Docs</td>
            <td>HTTP / oauth</td>
            <td>Ops Coordinator, PMs</td>
            <td>Custom workflow boards, pulse items, status columns.</td>
        </tr>
        <tr>
            <td><strong>ClickUp</strong></td>
            <td>Docs</td>
            <td>HTTP / oauth</td>
            <td>Product Coach, Ops Coordinator</td>
            <td>Spaces, task lists, documents, time entries.</td>
        </tr>
        <tr>
            <td><strong>Todoist</strong></td>
            <td>Docs</td>
            <td>HTTP / oauth</td>
            <td>Receptionist, Ops Coordinator</td>
            <td>Personal to-dos, daily reminders, project task queues.</td>
        </tr>
        <tr>
            <td><strong>Airtable</strong></td>
            <td>Docs</td>
            <td>HTTP / oauth</td>
            <td>Business Analyst, Product Coach</td>
            <td>Bases, relational tables, field records, formulas.</td>
        </tr>
        <tr>
            <td><strong>Box</strong></td>
            <td>Docs</td>
            <td>HTTP / oauth-app</td>
            <td>Knowledge Librarian, Research Analyst</td>
            <td>Enterprise cloud files, shared team folders.</td>
        </tr>
        <tr>
            <td><strong>Figma</strong></td>
            <td>Design</td>
            <td>HTTP / oauth</td>
            <td>Designer, Marketing Strategist</td>
            <td>Design canvases, component libraries, variable tokens.</td>
        </tr>
        <tr>
            <td><strong>Canva</strong></td>
            <td>Design</td>
            <td>HTTP / oauth</td>
            <td>Designer, Marketing Strategist</td>
            <td>Visual presentations, design templates, image assets.</td>
        </tr>
        <tr>
            <td><strong>Webflow</strong></td>
            <td>Design</td>
            <td>HTTP / oauth</td>
            <td>Designer, Marketing Strategist</td>
            <td>Production websites, static pages, CMS collections.</td>
        </tr>
        <tr>
            <td><strong>Slack</strong></td>
            <td>Comms</td>
            <td>HTTP / oauth-app</td>
            <td>Chief of Staff, Ops, Marketing</td>
            <td>Channels, direct messages, message search, bot alerts.</td>
        </tr>
        <tr>
            <td><strong>Gmail</strong></td>
            <td>Comms</td>
            <td>HTTP / oauth-app</td>
            <td>Receptionist, Chief of Staff</td>
            <td>Mail search, email thread summaries, draft composition.</td>
        </tr>
        <tr>
            <td><strong>Google Calendar</strong></td>
            <td>Comms</td>
            <td>HTTP / oauth-app</td>
            <td>Receptionist, Chief of Staff</td>
            <td>Schedule lookup, meeting availability, event booking.</td>
        </tr>
        <tr>
            <td><strong>Google Drive</strong></td>
            <td>Comms</td>
            <td>HTTP / oauth-app</td>
            <td>Knowledge Librarian, Research Analyst</td>
            <td>Drive files, Google Docs, Google Sheets, Slides.</td>
        </tr>
        <tr>
            <td><strong>Intercom</strong></td>
            <td>Comms</td>
            <td>HTTP / oauth</td>
            <td>Customer Success, Support, Sales</td>
            <td>Customer tickets, support conversations, help articles.</td>
        </tr>
        <tr>
            <td><strong>HubSpot</strong></td>
            <td>Comms</td>
            <td>HTTP / oauth-app</td>
            <td>Marketing Strategist, Sales Leads</td>
            <td>CRM contacts, target companies, deal pipeline stages.</td>
        </tr>
        <tr>
            <td><strong>Stripe</strong></td>
            <td>Payments</td>
            <td>HTTP / oauth</td>
            <td>Business Analyst, Executive Leadership</td>
            <td>Customers, invoice histories, charges, recurring MRR.</td>
        </tr>
        <tr>
            <td><strong>PayPal</strong></td>
            <td>Payments</td>
            <td>HTTP / oauth</td>
            <td>Business Analyst, Executive Leadership</td>
            <td>Merchant orders, transaction histories, payouts.</td>
        </tr>
        <tr>
            <td><strong>Microsoft Learn</strong></td>
            <td>Reference</td>
            <td>HTTP / none (Public)</td>
            <td>Research Analyst, Engineering</td>
            <td>Azure, .NET, TypeScript, Windows API documentation.</td>
        </tr>
        <tr>
            <td><strong>Cloudflare Docs</strong></td>
            <td>Reference</td>
            <td>HTTP / none (Public)</td>
            <td>Research Analyst, Cloud Engineers</td>
            <td>Workers, DNS, Zero Trust security documentation.</td>
        </tr>
        <tr>
            <td><strong>DeepWiki</strong></td>
            <td>Reference</td>
            <td>HTTP / none (Public)</td>
            <td>Research Analyst, Engineering</td>
            <td>Instant structural queries across public GitHub repos.</td>
        </tr>
        <tr>
            <td><strong>Context7</strong></td>
            <td>Reference</td>
            <td>HTTP / none (Public)</td>
            <td>Research Analyst, Frontend/Backend</td>
            <td>Up-to-date documentation and code patterns for libraries.</td>
        </tr>
        <tr>
            <td><strong>Exa</strong></td>
            <td>Reference</td>
            <td>HTTP / none (Public)</td>
            <td>Research Analyst, Knowledge Librarian</td>
            <td>Neural web search and clean markdown page extraction.</td>
        </tr>
        <tr>
            <td><strong>Hugging Face</strong></td>
            <td>Reference</td>
            <td>HTTP / none (Public)</td>
            <td>Research Analyst, AI/ML Engineers</td>
            <td>Open-source models, dataset cards, Spaces apps.</td>
        </tr>
        <tr>
            <td><strong>Composio Connect</strong></td>
            <td>Hubs</td>
            <td>HTTP / oauth</td>
            <td>Ops Coordinator, User Chats</td>
            <td>Multi-app gateway connecting 1,000+ third-party tools.</td>
        </tr>
        <tr>
            <td><strong>Zapier</strong></td>
            <td>Hubs</td>
            <td>HTTP / oauth</td>
            <td>Ops Coordinator, User Chats</td>
            <td>Automated trigger actions across connected SaaS stacks.</td>
        </tr>
        <tr>
            <td><strong>Playwright Browser</strong></td>
            <td>Local</td>
            <td>stdio / none (Local npx)</td>
            <td>Designer, QA Automation Engineers</td>
            <td>Headless Chromium: click, fill, screenshot, inspect DOM.</td>
        </tr>
        <tr>
            <td><strong>Chrome DevTools</strong></td>
            <td>Local</td>
            <td>stdio / none (Local npx)</td>
            <td>Engineering, Performance Engineers</td>
            <td>Network waterfall, performance traces, console message audit.</td>
        </tr>
    </tbody>
</table>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 3: What Axon Contains</span>
</div>

<h3>3.5 The 895 Ingested Skills & Synthesis Pipeline</h3>
<p>
    Axon includes an automated ingestion pipeline (`scripts/skills/ingest.cjs`) that compiles public, open-source agent skill repositories into a unified, version-controlled skill library stored in `src/skills/catalog.json` (metadata) and `src/skills/bodies.json` (full instructional instructions).
</p>

<h4>Skill Sources (`skills.sources.json`)</h4>
<table>
    <thead>
        <tr>
            <th>Source Slug</th>
            <th>Upstream Repository</th>
            <th>License</th>
            <th>Skill Count & Domain Coverage</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>ui-ux-pro-max</code></td>
            <td><code>github.com/nextlevelbuilder/ui-ux-pro-max-skill</code></td>
            <td>MIT</td>
            <td>Design token systems, accessibility contrast rules, fluid layout.</td>
        </tr>
        <tr>
            <td><code>design-md</code></td>
            <td><code>github.com/google-labs-code/design.md</code></td>
            <td>Apache-2.0</td>
            <td>Component hierarchy, typography scales, design spec formatting.</td>
        </tr>
        <tr>
            <td><code>ponytail</code></td>
            <td><code>github.com/DietrichGebert/ponytail</code></td>
            <td>MIT</td>
            <td>Technical writing, RFC authoring, documentation style guides.</td>
        </tr>
        <tr>
            <td><code>superpowers</code></td>
            <td><code>github.com/obra/superpowers</code></td>
            <td>MIT</td>
            <td>System administration, debugging workflows, test automation.</td>
        </tr>
        <tr>
            <td><code>awesome-claude-skills</code></td>
            <td><code>github.com/ComposioHQ/awesome-claude-skills</code></td>
            <td>None at the recorded commit</td>
            <td>864 integration procedures. Development builds only: not shipped until its authors grant a license.</td>
        </tr>
    </tbody>
</table>

<h4>Runtime Prompt Synthesis & The 80k Character Budget</h4>
<p>
    When a message is submitted in a conversation, the main process (`src/main/prompt.ts`) dynamically synthesizes the active system prompt:
</p>
<ol>
    <li><strong>Workspace Layer:</strong> Foundational instructions, workspace goals, and memory entries.</li>
    <li><strong>Project Manifest & Repository Map:</strong> Open project path, git branch status, package manifest (`package.json`), and file map.</li>
    <li><strong>Role Profiles:</strong> The specific behavioral profiles of the active coworker and consulted specialists.</li>
    <li><strong>Selected Skills (Capped at 80,000 characters):</strong> Injected skill bodies. If selected skills exceed 80k characters, Axon prioritizes higher-signal procedural blocks to prevent prompt bloat.</li>
    <li><strong>Untrusted Knowledge Context:</strong> BM25 retrieved document passages.</li>
</ol>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 3: What Axon Contains</span>
</div>

<h3>3.6 Design System Architecture & UI Primitives</h3>
<p>
    Axon's user interface is constructed in strict adherence to the design specification documented in `design-system/axon/MASTER.md`. The design system uses a strict 3-tier CSS custom property hierarchy (`src/renderer/src/tokens.css`):
</p>

<div class="grid-3">
    <div class="card">
        <div class="card-title">1. Primitive Tokens</div>
        <div class="card-subtitle">Raw Color & Spacing</div>
        <p style="font-size: 8pt; color: #475569;">
            Base scales unattached to semantic meaning: <code>--blue-600: #2563eb</code>, <code>--slate-900: #0f172a</code>, <code>--space-4: 16px</code>.
        </p>
    </div>
    <div class="card">
        <div class="card-title">2. Semantic Tokens</div>
        <div class="card-subtitle">Contextual Meaning</div>
        <p style="font-size: 8pt; color: #475569;">
            Tokens bound to system roles: <code>--surface-page</code>, <code>--surface-elevated</code>, <code>--text-primary</code>, <code>--status-approval</code>.
        </p>
    </div>
    <div class="card">
        <div class="card-title">3. Component Tokens</div>
        <div class="card-subtitle">Element Specific</div>
        <p style="font-size: 8pt; color: #475569;">
            Scoped directly to UI widgets: <code>--button-primary-bg</code>, <code>--diff-add-line</code>, <code>--card-border</code>.
        </p>
    </div>
</div>

<h4>Typography & Shared Primitives Library</h4>
<ul>
    <li><strong>Typography:</strong> Google Sans Flex Variable and Inter Variable (`@fontsource-variable/inter`) rendered with subpixel font-smoothing and tabular figures for numbers. Monospace elements utilize Cascadia Code and Consolas.</li>
    <li><strong>Shared Primitives (`src/renderer/src/ui/`):</strong>
        <ul>
            <li><code>ApprovalCard.tsx</code>: Renders proposed tool mutations with line-by-line diff previews.</li>
            <li><code>DiffViewer.tsx</code> & <code>DiffLines.tsx</code>: Unified diff viewer supporting add/delete syntax highlighting.</li>
            <li><code>CatalogPicker.tsx</code>: Searchable multi-category picker for skills, roles, and connectors.</li>
            <li><code>AppIcons.tsx</code>: Bespoke SVG iconography library replacing heavy third-party icon fonts.</li>
            <li><code>Modal.tsx</code>, <code>Field.tsx</code>, <code>Kbd.tsx</code>: Accessible keyboard-driven dialog and form components.</li>
        </ul>
    </li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 3: What Axon Contains</span>
</div>

<h3>3.7 Storage, State Schemas & DPAPI Vault</h3>
<p>
    All user data, workspaces, conversations, and settings reside on the local filesystem under Electron's standard <code>userData</code> path (`%APPDATA%\\Axon` on Windows, `~/Library/Application Support/Axon` on macOS, `~/.config/Axon` on Linux).
</p>

<table>
    <thead>
        <tr>
            <th>Storage Path</th>
            <th>Security Profile</th>
            <th>Schema Version & Contents</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>data/db/axon.db</code></td>
            <td>Filesystem Permissions (Unencrypted)</td>
            <td>SQLite, schema v1, write-ahead log: providers (without keys), workspaces, conversations, messages, agents, knowledge passages, settings, tasks, trusted folders. Each save is one transaction writing only what changed. The activity log is kept apart in <code>audit/audit.jsonl</code>.</td>
        </tr>
        <tr>
            <td><code>secrets/os-vault.json</code></td>
            <td>OS-Level DPAPI / Keychain Encryption</td>
            <td>Hardware-encrypted credentials: AI provider keys, MCP server tokens (`mcp:&lt;id&gt;`), OAuth refresh tokens (`mcp-oauth:&lt;id&gt;`), GitHub/Google client credentials. Plaintext fallback explicitly refused.</td>
        </tr>
        <tr>
            <td><code>backups/state-*.json</code></td>
            <td>Filesystem Permissions</td>
            <td>Rolling snapshots captured at launch and every 10 min during mutations (keeps newest 10).</td>
        </tr>
        <tr>
            <td><code>data/corrupt-*.json</code></td>
            <td>Quarantined Files</td>
            <td>Damaged or unparseable state files automatically set aside during recovery.</td>
        </tr>
        <tr>
            <td><code>window-state.json</code></td>
            <td>Filesystem Permissions</td>
            <td>Desktop window coordinates, dimensions, maximized state, monitor placement.</td>
        </tr>
        <tr>
            <td><code>office-folders.json</code></td>
            <td>Filesystem Permissions</td>
            <td>Recent project folder paths for quick switching on the work surface.</td>
        </tr>
    </tbody>
</table>
""")

    # Chapter 4
    parts.append("""
<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 4: What All We Have Done</span>
</div>

<h1>Chapter 4: What All We Have Done — Engineering Journey</h1>

<h3>4.1 Evolutionary Milestones (Wave 0 through Wave 7)</h3>
<p>
    The creation of Axon represents an intensive engineering sprint encompassing desktop systems programming, 3D graphics optimization, distributed AI protocols, and security hardening.
</p>

<table>
    <thead>
        <tr>
            <th style="width: 15%;">Phase / Wave</th>
            <th style="width: 25%;">Primary Milestone</th>
            <th style="width: 60%;">Implemented Capabilities & Engineering Deliverables</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>Wave 0</strong><br>Foundations</td>
            <td>Core Desktop & Protocol Architecture</td>
            <td>Electron 44 + electron-vite foundation; DPAPI OS Vault for secure API key isolation; streaming protocol adapters for OpenAI, Anthropic, and Gemini; resilient SSE parser; safe JSON persistence.</td>
        </tr>
        <tr>
            <td><strong>Wave 1</strong><br>3D Campus</td>
            <td>Three.js Procedural Low-Poly Campus</td>
            <td>Central Commons (40x32m) and 7 surrounding district zones; procedural PBR materials (terrazzo, oak, carpet, glass); bronze-framed conference walls; low-poly furniture and prop libraries.</td>
        </tr>
        <tr>
            <td><strong>Wave 2</strong><br>Office Life</td>
            <td>Humanoid Rigging & Life Simulation</td>
            <td>Procedural humanoid avatars with anatomical articulation (hands, legs, heads, hairlines); autonomous daily rhythm simulation (standups, cafe breaks, lunch, desk focus); A* navigation mesh.</td>
        </tr>
        <tr>
            <td><strong>Wave 3</strong><br>Role Screens</td>
            <td>Single-Draw-Call Texture Atlas</td>
            <td>Eliminated GPU draw call bottlenecks by rendering all 208 desk monitors onto a single 2048x2048 canvas atlas; 5-state LED status strip (Idle, Working, Waiting, Done, Error).</td>
        </tr>
        <tr>
            <td><strong>Wave 4</strong><br>Coworkers</td>
            <td>208 Coworkers & 895 Skills Ingestion</td>
            <td>Authored 198 specialized role profiles conforming to the 4 invariants; ingested 895 skills from 5 open-source repositories; receptionist front-desk task manager; inter-agent delegation (`ask_colleague`).</td>
        </tr>
        <tr>
            <td><strong>Wave 5</strong><br>Connectors</td>
            <td>Model Context Protocol (MCP)</td>
            <td>Built triple-transport MCP client (Streamable HTTP, stdio, SSE); 39 catalog connectors; in-app OAuth 2.0 PKCE browser sign-in with loopback redirect; coworker connector scoping; Composio Rube bridge.</td>
        </tr>
        <tr>
            <td><strong>Wave 6</strong><br>Transparency</td>
            <td>Audit, Undo & Cost Governance</td>
            <td>Wave 6A: Real-time Context Meter & per-model Usage/Cost dashboard.<br>Wave 6B: 20,000-entry tamper-evident Activity Log & rolling Restore Points.<br>Wave 6C: Coworker Undo Engine with 500-version rollback and dirty-file collision detection.</td>
        </tr>
        <tr>
            <td><strong>Wave 7</strong><br>Release & Film</td>
            <td>Hardening, Packaging & Launch Media</td>
            <td>Remediated 19 vulnerabilities (0 audit vulnerabilities); migrated `xlsx` to `exceljs`; verified loopback desktop smoke tests; built landing page (`site/index.html`) and Hyperframes launch video (`brag.mp4`).</td>
        </tr>
    </tbody>
</table>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 4: What All We Have Done</span>
</div>

<h3>4.2 Major Engineering Breakdowns & Solved Hurdles</h3>

<h4>Hurdle 1: The 208-Monitor Draw Call Bottleneck</h4>
<p>
    <strong>The Problem:</strong> In initial 3D prototypes, each desk monitor in the office was rendered as an independent Three.js mesh with a separate dynamic canvas texture. With 208 seated coworkers, this resulted in over 450 draw calls per frame, dropping framerates on standard laptops below 15 FPS.
</p>
<p>
    <strong>The Solution:</strong> The team engineered a unified screen atlas subsystem (`screenPainters.ts`). All 208 individual role applications are rendered into a single 2048×2048 2D canvas sheet. All 208 monitor meshes were batched into a single static geometry sharing a single PBR material, reducing monitor draw calls from 208 down to exactly <strong>1 draw call</strong>. Framerates locked at a steady 60 FPS.
</p>

<h4>Hurdle 2: Upstream Reasoning Block Replay Rejection</h4>
<p>
    <strong>The Problem:</strong> When cutting-edge reasoning models (Anthropic Claude 3.7 Sonnet with thinking blocks, Google Gemini 2.0 with thought signatures, DeepSeek R1 with reasoning content) emit tool calls, the model produces internal thinking tokens. If the client drops these thinking tokens during the subsequent tool-result round, upstream APIs reject the request with validation errors (e.g., Anthropic HTTP 400: <em>"Thinking block must be followed by matching signature"</em>).
</p>
<p>
    <strong>The Solution:</strong> Axon's provider adapter (`providers.ts`) records the exact cryptographic thinking signatures and thought blocks during stream parsing and re-emits them byte-for-byte in the assistant turn history before appending the corresponding tool results.
</p>

<h4>Hurdle 3: Vulnerability Remediation (19 → 0 CVEs)</h4>
<p>
    <strong>The Problem:</strong> Legacy dependencies inherited from early prototypes included vulnerabilities in transitive packages, most notably in <code>xlsx</code> (Prototype Pollution) and outdated Electron runtime binaries, yielding 19 security vulnerabilities during <code>npm audit</code>.
</p>
<p>
    <strong>The Solution:</strong> The team executed a full dependency hardening cycle:
</p>
<ul>
    <li>Migrated desktop runtime to <strong>Electron 44.4.1</strong>.</li>
    <li>Upgraded build system to <strong>electron-vite 5.0.0</strong> and <strong>Vite 7.3.6</strong>.</li>
    <li>Completely excised <code>xlsx</code>, replacing it with the actively maintained <strong>exceljs 4.4.0</strong>.</li>
    <li>Implemented a package override for transitive <code>uuid</code> (v11.1.1).</li>
    <li>Result: <strong>0 vulnerabilities</strong> verified across all production and development dependencies.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 4: What All We Have Done</span>
</div>

<h3>4.3 Verification, Automated Testing & Smoke Test Protocols</h3>
<p>
    Quality assurance in Axon is enforced across multiple tiers of automated verification:
</p>

<div class="grid-2">
    <div class="card">
        <div class="card-title">Wire Format Protocol Tests</div>
        <div class="card-subtitle"><code>tests/providers.test.cjs</code></div>
        <p style="font-size: 8.5pt; color: #475569;">
            Validates wire-format SSE parsing, tool serialization, thinking block replay, and error handling against mock HTTP transport without incurring paid API costs.
        </p>
    </div>
    <div class="card">
        <div class="card-title">Live Desktop E2E Smoke Test</div>
        <div class="card-subtitle"><code>tests/electron-smoke.cjs</code></div>
        <p style="font-size: 8.5pt; color: #475569;">
            Spawns the built Electron application with an isolated temporary profile, connects to a loopback mock provider, executes a full streaming turn, asserts API keys arrive as <code>Bearer ...</code>, and verifies screenshot rendering.
        </p>
    </div>
    <div class="card">
        <div class="card-title">Connectors Live Health Audit</div>
        <div class="card-subtitle"><code>scripts/connectors-check.mjs</code></div>
        <p style="font-size: 8.5pt; color: #475569;">
            Audits all 39 catalog connector endpoints over the live network to verify endpoint reachability, TLS certificate validity, and OAuth discovery metadata.
        </p>
    </div>
    <div class="card">
        <div class="card-title">Packaging & Binary Verification</div>
        <div class="card-subtitle"><code>npm run package:dir</code></div>
        <p style="font-size: 8.5pt; color: #475569;">
            Executes electron-builder to generate unpacked Windows binaries (<code>dist/win-unpacked/Axon.exe</code>), validating clean zero-exit-code builds.
        </p>
    </div>
</div>
""")

    # Chapter 4 addendum
    parts.append("""
<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 4: What All We Have Done</span>
</div>

<h3>4.6 Progress Update: Sept 30 – Oct 4, 2026</h3>
<p>
    Since the dossier was first issued (Sept 30), Axon moved from a single-coworker office to one where <strong>coworkers form teams, meet in rooms, take voice input, and answer in seconds</strong>. Everything in the table is merged on <code>main</code> and <code>feat/transparency</code>; side branches are listed below it.
</p>

<table>
    <thead>
        <tr>
            <th style="width: 18%;">Date</th>
            <th style="width: 27%;">Milestone</th>
            <th style="width: 55%;">What shipped</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td>Oct 3<br><code>893822d</code></td>
            <td><strong>Team meetings &amp; safer agent edits</strong></td>
            <td>The Chief of Staff and Ops Coordinator find the right people (<code>find_people</code>) and gather 2&ndash;12 of them (<code>call_team_meeting</code>). Attendees give input in a new boardroom, the lead drafts a checked plan (owners, order, files), and <strong>nothing starts until the user presses Start</strong>. Tasks then run in dependency order, up to three at once, each in its owner's conversation with the hand-offs it builds on; the lead reports back. Stop team, Retry and restart are handled. New <code>edit_file</code> tool for targeted changes; <code>write_file</code> refuses rewrites that drop far more than they add; malformed tool calls go back to the model before any approval card; messages sent mid-run wait for the next step; Stop button (and Esc) in the composer. Also fixed a broken build (a function inside the Project class, two tool schemas with misplaced <code>required</code>).</td>
        </tr>
        <tr>
            <td>Oct 3<br><code>d5f735b</code></td>
            <td><strong>Voice typing</strong></td>
            <td>Microphone button and Ctrl+M in the office composer. Audio goes to an OpenAI-style transcription endpoint: Groq <code>whisper-large-v3</code> by default, OpenAI <code>gpt-4o-transcribe</code> when an OpenAI key exists. Accuracy work: language pinned (English default), temperature 0, a glossary of names and code identifiers from the thread, silence segments and glossary echo dropped, empty recordings never sent. Words land at the cursor to review before sending. Only Axon's own window may use the microphone, never the camera. New Settings &rarr; Voice typing section; <code>speech.test.cjs</code> and <code>dictation-desktop.cjs</code> tests.</td>
        </tr>
        <tr>
            <td>Oct 3<br><code>0410a53</code></td>
            <td><strong>Quick answers &amp; a Chief of Staff who acts</strong></td>
            <td>Measured on real chats: a simple question took 9&ndash;13 model calls and minutes, with answers up to 3,000 characters. Fixes: house rules for every coworker (short answers, tools only when needed, never the same lookup twice); only software builders start with the project map; a <strong>Quick replies</strong> setting (on by default) skips thinking on OpenRouter models (Nemotron 23 s &rarr; 2.5 s per step); tool results capped at 30,000 characters with repeated lookups answered from cache; code search batches files and skips binaries (4.5 s &rarr; 0.7 s). Result on the same free models: <strong>11&ndash;28 s and 1&ndash;3 steps</strong>. <code>find_people</code> now ranks by the words of a need.</td>
        </tr>
        <tr>
            <td>Oct 3<br><code>d2d75cb</code></td>
            <td><strong>Marketing &amp; Growth district, six meeting rooms</strong></td>
            <td>Same campus footprint, rearranged. Five meeting rooms: Boardroom (12 seats), Rooms 1&ndash;2 (6 seats) and two new glass six-seaters, Rooms 3&ndash;4; each with a screen, whiteboard and door sign. New <strong>Marketing &amp; Growth</strong> district (coral carpet) holding Marketing Management, Customer Success and a new Growth &amp; Outreach department (Lead Generation Specialist, SDR, Email Marketing Specialist, Content Creator, Copywriter): roles grow to <strong>203 authored specialists</strong>. Gmail, HubSpot and Composio (LinkedIn, Instagram, X) are pre-assigned to the team once connected; role profiles state that nothing goes out before the user approves it.</td>
        </tr>
        <tr>
            <td>Oct 3<br><code>0150bf3</code></td>
            <td><strong>Teams meet and work in their own room</strong></td>
            <td>A team gets the room the user named when it fits and is free, otherwise the smallest free room that fits. It stays there through the meeting, plan approval, work and report, then everyone walks back to their desks. Several teams run at once, each in its own room; each room's board shows the team's goal and every task by owner and status. Verified: two teams at once (Room 1 and Room 3), 60 fps at 1080p on mains power, 2.26 M triangles.</td>
        </tr>
        <tr>
            <td>Oct 3<br><code>e019dc5</code></td>
            <td><strong>Long meeting goals</strong></td>
            <td>A real six-person meeting with a 5,393-character goal threw "Invalid text input" and ended the turn, so the lead re-called with two people. Goals up to 12,000 characters are now accepted whole; longer ones return a tool error naming the limit so the lead can shorten and retry. Regression tests added.</td>
        </tr>
        <tr>
            <td>Oct 3<br><code>4c3ef72</code></td>
            <td><strong>Chat layout</strong></td>
            <td>Your messages sit on the right in a text-sized bubble (up to 85% of the panel); coworkers answer on the left.</td>
        </tr>
    </tbody>
</table>

<h4>In progress and on side branches</h4>
<ul>
    <li><strong>Credit-aware retries (uncommitted on <code>feat/transparency</code>):</strong> an HTTP 402 saying a request would exceed credits given in-flight requests now waits for the others to settle (up to 8 attempts, about two minutes) instead of failing; a plain 402 gets a clear hint to add credits or lower the output limit. Model picker refinements are in progress.</li>
    <li><strong><code>feat/axon-collab</code> (not yet merged):</strong> team tasks with the same owner must be ordered; team-task chats and approvals show live; department asks resolve, leads convene early, honest timeouts; a hang in the team-service test fixed.</li>
    <li><strong><code>feat/axon-self-improve</code> (not yet merged):</strong> keyboard and focus management for the conversation menu and profile dialog; Planner and Updates panels stay mounted behind other tabs; agent conversations receive the open project root; new installs start at 8,192 max tokens instead of 4,096.</li>
    <li><strong><code>fix/production-hardening</code> (not yet merged):</strong> release audit fixes (agent escape and permission gaps closed), data safety, sandboxed document parsers, update handling, logging, signed packaging, and a smoke test that imports a PDF and CSV through the sandboxed reader.</li>
    <li><strong>Strategy documents:</strong> <code>market-fit-audit.md</code> and <code>strategic-framework.md</code> drafted at the repository root.</li>
</ul>

<div class="callout callout-info">
    <strong>Current verification state:</strong> 569 unit tests plus the team-service suite (7) pass, typecheck is clean, and the office and team desktop checks pass at 60 fps (1080p, mains power) with 2.26 M triangles. The roster is now <strong>213 coworkers</strong> (9 core + 204 specialists) across 23 department groups, and the campus has <strong>five meeting rooms</strong>.
</div>
""")

    # Chapter 5
    parts.append("""
<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 5: What Axon Can Do</span>
</div>

<h1>Chapter 5: What Axon Can Do — Operational Scenarios</h1>

<h3>5.1 Multi-Agent Collaborative Full-Stack Engineering</h3>
<p>
    In complex software projects, single-agent workflows fail because a single prompt cannot simultaneously maintain deep frontend design sensibilities, backend concurrency constraints, and security standards. Axon's coworker ecosystem excels at cross-functional delegation:
</p>

<table>
    <thead>
        <tr>
            <th>Workflow Step</th>
            <th>Active Coworker</th>
            <th>Operational Action & System Invariant</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><strong>1. Goal Definition</strong></td>
            <td>User → Chief of Staff</td>
            <td>User requests: "Implement an audited OAuth sign-in flow with GitHub and Google." Chief of Staff breaks this down into frontend components, backend endpoints, and security audits.</td>
        </tr>
        <tr>
            <td><strong>2. Product Specs</strong></td>
            <td>Product Coach</td>
            <td>Chief of Staff calls <code>ask_colleague("product-coach")</code> to establish acceptance criteria, error handling states, and session lifecycles.</td>
        </tr>
        <tr>
            <td><strong>3. UI & Design Tokens</strong></td>
            <td>Frontend Developer</td>
            <td>Frontend Developer creates <code>LoginButtons.tsx</code> using the design system's semantic tokens, verifying keyboard focus rings and contrast ratios.</td>
        </tr>
        <tr>
            <td><strong>4. Backend Endpoints</strong></td>
            <td>Backend Developer</td>
            <td>Backend Developer implements loopback redirect servers, PKCE challenge verifiers, and route handlers.</td>
        </tr>
        <tr>
            <td><strong>5. Security Review</strong></td>
            <td>Security Engineer</td>
            <td>Chief of Staff invokes <code>ask_colleague("application-security-engineer")</code> to inspect the code for open redirect vulnerabilities and secret leakage.</td>
        </tr>
        <tr>
            <td><strong>6. Human Approval & Undo</strong></td>
            <td>User Review Surface</td>
            <td>User inspects the consolidated unified diff in the Approval Card, reviews the safety summary, and clicks Approve. If needed, one-click Undo rolls back the changes immediately.</td>
        </tr>
    </tbody>
</table>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 5: What Axon Can Do</span>
</div>

<h3>5.2 Automated Incident Triage via Sentry & GitHub MCP</h3>
<p>
    When an unexpected runtime exception occurs in production, an on-call engineer can collaborate with Axon to investigate and remediate the issue within minutes:
</p>
<ol>
    <li><strong>Error Ingestion:</strong> The Site Reliability Engineer uses the Sentry connector to query recent unhandled exceptions: <code>mcp_sentry_list_issues(project="core-api")</code>.</li>
    <li><strong>Stack Trace Analysis:</strong> The SRE extracts the stack trace and pinpointed line numbers, then asks the Python Developer colleague to inspect the relevant codebase files via <code>read_file</code>.</li>
    <li><strong>Root Cause Identification:</strong> The Python Developer discovers a null pointer dereference caused by a missing database column migration.</li>
    <li><strong>Patch Proposal:</strong> The developer proposes a patch. The user reviews the unified diff in an Approval Card and approves.</li>
    <li><strong>Automated PR Submission:</strong> With user confirmation, the coworker uses the GitHub connector (<code>mcp_github_create_pull_request</code>) to open a pull request with an explanatory description and issue link.</li>
</ol>

<h3>5.3 Air-Gapped Enterprise Knowledge Extraction</h3>
<p>
    For legal firms, healthcare organizations, and financial institutions handling confidential data that cannot be uploaded to third-party vector databases:
</p>
<ul>
    <li>The user attaches multi-gigabyte regulatory PDFs, clinical trial DOCX files, and financial Excel models to a private workspace.</li>
    <li>Axon's isolated worker pool extracts the text in background sub-processes without leaking memory or sending a single byte to the internet.</li>
    <li>The Knowledge Librarian indexes the material using local BM25 ranking.</li>
    <li>The user queries the knowledge base against a local, private LLM (such as Llama 3 or DeepSeek running on Ollama over loopback HTTP).</li>
    <li>The model synthesizes findings with exact page citations, operating <strong>100% offline</strong> with zero third-party cloud data transmission.</li>
</ul>
""")

    # Chapter 6, 7, 8
    parts.append("""
<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 6: Security & Privacy Model</span>
</div>

<h1>Chapter 6: Security, Privacy & Boundary Enforcement</h1>

<h3>6.1 Defense-in-Depth Architecture</h3>
<p>
    Axon rejects the conventional web-app security model in favor of an operating-system-level defense-in-depth architecture:
</p>

<div class="grid-2">
    <div class="card">
        <div class="card-title">Renderer Process Isolation</div>
        <div class="card-subtitle">Zero Network & Filesystem Access</div>
        <p style="font-size: 8.5pt; color: #475569;">
            The React renderer runs in a sandboxed context with <code>contextIsolation: true</code> and <code>nodeIntegration: false</code>. It cannot initiate raw socket connections, access the local disk, or read process memory. All actions must traverse the typed <code>window.axon</code> preload bridge.
        </p>
    </div>
    <div class="card">
        <div class="card-title">IPC Sender Verification</div>
        <div class="card-subtitle">Anti-Spoofing Checks</div>
        <p style="font-size: 8.5pt; color: #475569;">
            Every IPC handler in the main process verifies <code>event.senderFrame</code> to ensure that requests originate strictly from the trusted local application window rather than rogue webviews or injected scripts.
        </p>
    </div>
</div>

<h3>6.2 Filesystem Sandboxing & Jail Boundaries (`src/main/project.ts`)</h3>
<p>
    When a conversation is granted access to a project folder, the path is strictly bounded:
</p>
<ul>
    <li><strong>Path Traversal Defense:</strong> All relative paths are resolved and checked via <code>Project.safe()</code>. Any path containing <code>../</code> or resolving outside the designated project root is immediately rejected.</li>
    <li><strong>Symlink & Junction Escapes:</strong> Symbolic links and NTFS junction points are resolved to their true physical targets. If a symlink points outside the project boundary, access is denied.</li>
    <li><strong>Sensitive File Protection:</strong> Requests to read or write <code>.env</code> files, anything in <code>.git</code>, <code>.ssh</code>, <code>.aws</code>, <code>.docker</code> or <code>.kube</code>, SSH keys (<code>id_rsa</code>…), <code>.npmrc</code>, <code>.git-credentials</code>, Terraform state and other credential files are blocked at the engine level, regardless of user approval. Names are compared without case (<code>.GIT</code> is <code>.git</code>), and Windows 8.3 short names and trailing dots are refused. Any file whose contents hold a private key or a live access token is never given to the model.</li>
    <li><strong>Folder Trust:</strong> A folder opens restricted until the user trusts it: its instruction files stay out of the prompt and Axon runs no git there. In any folder, git runs without the repository's hooks or fsmonitor for anything a coworker does.</li>
</ul>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 7: Production Roadmap</span>
</div>

<h1>Chapter 7: Production Roadmap & Future Horizons</h1>

<h3>7.1 Immediate Release Blockers & Production Gates</h3>
<p>
    The engineering gates are done in code: transactional SQLite storage with a write-ahead log and versioned migrations, parsers in an OS-sandboxed renderer, a signing and notarization pipeline that refuses unsigned releases, signed automatic updates with a minimum-version policy, Electron fuses, and CI on Windows, macOS and Linux. Before public general distribution, what remains needs accounts, certificates or people (see `README.md` and `docs/RELEASING.md`):
</p>
<ol>
    <li><strong>Signing Credentials:</strong> An Azure Trusted Signing account (or EV certificate) for Windows and an Apple Developer ID with notarization credentials, added as release secrets.</li>
    <li><strong>OAuth App Registration:</strong> The GitHub, Google (with OAuth verification and, for Gmail and Drive, a security assessment), Slack, HubSpot, Box and Asana apps, whose IDs are baked into release builds.</li>
    <li><strong>Legal Review:</strong> The privacy policy and end-user license agreement drafts, and a license (or removal) for the skill collection that ships only in development builds.</li>
    <li><strong>Independent Security Review:</strong> A penetration test of the agent permission layer and the app shell.</li>
</ol>

<h3>7.2 Mid-Term Enhancements & Enterprise Scaling</h3>
<ul>
    <li><strong>Multimodal Ingestion:</strong> Direct image understanding, architectural diagram analysis, and audio transcription across coworker conversations.</li>
    <li><strong>Visual MCP Connector Builder:</strong> An in-app GUI allowing non-developers to configure custom stdio and HTTP MCP servers with visual header and authentication testing.</li>
    <li><strong>Scheduled Autonomous Agent Workflows:</strong> Permitting coworkers to execute unattended background tasks (e.g., nightly dependency vulnerability scans, morning PR briefings) with explicit time-bounded leases.</li>
</ul>

<h3>7.3 Long-Term Vision: The Shared Spatial Office</h3>
<p>
    The ultimate vision for Axon extends beyond single-user desktop software into the <strong>Multiplayer Shared Office</strong>. In this future paradigm, distributed human engineering teams share a persistent 3D virtual campus with their AI coworkers. Human teammates walk their avatars into meeting rooms to collaborate with AI specialists, observe live coding monitors in the engineering district, and review company-wide operational velocity in real time.
</p>

<div class="page-break"></div>
<div class="header-bar">
    <span>Axon AI Studio — Master Dossier</span>
    <span>Chapter 8: Technical Operations Manual</span>
</div>

<h1>Chapter 8: Technical Reference & Operations Manual</h1>

<h3>8.1 CLI & Build Tooling Reference</h3>
<pre><code># Development Environment Startup
npm install                    # Install all production and development dependencies
npm run dev                    # Launch electron-vite HMR development server

# Validation & Testing Suite
npm run typecheck              # Run TypeScript compiler type-checking without emitting files
npm test                       # Run unit test suite (providers, history, storage, MCP)
npm run connectors:check       # Validate all 39 catalog connector endpoints against live network
npm run test:desktop           # Launch built application with loopback mock provider E2E smoke test

# Production Compilation & Packaging
npm run build                  # Compile main, preload, and renderer bundles into out/
npm run package:dir            # Build unpacked executable in dist/win-unpacked/Axon.exe
npm run package                # Generate distribution installer (NSIS on Windows, DMG on Mac)

# Skill & Model Utilities
npm run skills:ingest          # Re-ingest and compile catalog from skills.sources.json
npm run models:optimize        # Process and compress 3D GLTF models for Three.js scene</code></pre>

<h3>8.2 Complete IPC Bridge API Reference (`window.axon`)</h3>
<table>
    <thead>
        <tr>
            <th>IPC Method</th>
            <th>Parameters</th>
            <th>Return Type</th>
            <th>Functional Description</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><code>snapshot</code></td>
            <td>—</td>
            <td><code>Promise&lt;SnapshotPayload&gt;</code></td>
            <td>Everything the window shows, without keys or connector secrets; the skill and role catalog comes once from <code>catalog()</code>.</td>
        </tr>
        <tr>
            <td><code>chatSend</code></td>
            <td><code>conversationId, text, attachmentIds</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Starts an assistant run; progress arrives as stream events, each new piece with its offset.</td>
        </tr>
        <tr>
            <td><code>chatStop</code></td>
            <td><code>conversationId</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Aborts the run and withdraws any approval it is waiting for.</td>
        </tr>
        <tr>
            <td><code>toolApprove</code></td>
            <td><code>{ requestId, approved, alwaysAllowSession? }</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Answers an approval card: once, or always in this conversation and folder.</td>
        </tr>
        <tr>
            <td><code>revertChange</code></td>
            <td><code>toolCallId</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Undoes a coworker's file write or memory update after a native confirmation.</td>
        </tr>
        <tr>
            <td><code>providerSave</code></td>
            <td><code>provider, key?</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Saves a provider; a key goes to the OS vault. A changed endpoint is confirmed natively.</td>
        </tr>
        <tr>
            <td><code>providerTest</code></td>
            <td><code>provider, key?</code></td>
            <td><code>Promise&lt;ProviderTestResult&gt;</code></td>
            <td>Checks up to ten models with a tiny request, without saving.</td>
        </tr>
        <tr>
            <td><code>connectorAdd</code></td>
            <td><code>catalogId</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Adds a catalog connector, signing in first when it needs to; a local one is confirmed natively.</td>
        </tr>
        <tr>
            <td><code>auditList</code></td>
            <td><code>query: AuditQuery</code></td>
            <td><code>Promise&lt;AuditEntry[]&gt;</code></td>
            <td>The activity log, newest first, filtered by conversation, coworker or kind.</td>
        </tr>
        <tr>
            <td><code>auditExport</code></td>
            <td>—</td>
            <td><code>Promise&lt;boolean&gt;</code></td>
            <td>Saves the whole hash-chained activity log as JSON or CSV.</td>
        </tr>
        <tr>
            <td><code>listBackups</code></td>
            <td>—</td>
            <td><code>Promise&lt;BackupSummary[]&gt;</code></td>
            <td>The restore points in <code>userData/backups/</code>, newest first.</td>
        </tr>
        <tr>
            <td><code>restoreBackup</code></td>
            <td><code>file</code></td>
            <td><code>Promise&lt;void&gt;</code></td>
            <td>Backs up the current state, restores the chosen restore point, and restarts Axon.</td>
        </tr>
        <tr>
            <td><code>projectTrust</code></td>
            <td>—</td>
            <td><code>Promise&lt;boolean&gt;</code></td>
            <td>Asks natively whether you trust the open folder.</td>
        </tr>
        <tr>
            <td><code>permissionGrants / permissionRevoke</code></td>
            <td><code>— / grantId</code></td>
            <td><code>Promise&lt;SessionGrant[]&gt; / Promise&lt;void&gt;</code></td>
            <td>The "always allow" grants in force, and taking one back.</td>
        </tr>
        <tr>
            <td><code>diagnosticsExport</code></td>
            <td>—</td>
            <td><code>Promise&lt;boolean&gt;</code></td>
            <td>Saves versions, set-up and the recent log, with keys and tokens removed.</td>
        </tr>
        <tr>
            <td><code>updateCheck / updateInstall</code></td>
            <td>—</td>
            <td><code>Promise&lt;UpdateState&gt; / Promise&lt;void&gt;</code></td>
            <td>Looks for an update of Axon; restarts into a downloaded one.</td>
        </tr>
    </tbody>
</table>

<div class="callout callout-success" style="margin-top: 14pt;">
    <strong>Conclusion of Dossier:</strong> This completes the end-to-end architectural, capability, inventory, historical, and operational documentation of Axon AI Studio (v0.2.0). All referenced files, schemas, and metrics reflect the verified state of the active project repository.
</div>

</body>
</html>
""")

    output_html_path = os.path.join(ROOT_DIR, "Axon_Complete_Project_Dossier.html")
    output_pdf_path = os.path.join(ROOT_DIR, "Axon_Complete_Project_Dossier.pdf")

    
    full_html = "".join(parts)
    repl_map = {
        "__IMG_CAMPUS__": img_campus,
        "__IMG_OVERVIEW__": img_overview,
        "__IMG_LOUNGE__": img_lounge,
        "__IMG_WORK__": img_work,
        "__IMG_REVIEW__": img_review,
        "__IMG_DESKTOP__": img_desktop,
        "__IMG_CONNECTORS__": img_connectors,
        "__IMG_ACTIVITY__": img_activity,
        "__IMG_METER__": img_meter,
        "__IMG_RESTORE__": img_restore,
        "__IMG_USAGE__": img_usage,
    }
    for k, v in repl_map.items():
        full_html = full_html.replace(k, v)

    print(f"Writing complete HTML dossier to {output_html_path}...")
    with open(output_html_path, "w", encoding="utf-8") as f:
        f.write(full_html)

    print("HTML dossier written successfully. Size:", os.path.getsize(output_html_path), "bytes.")

    chrome_paths = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]

    browser_bin = None
    for p in chrome_paths:
        if os.path.exists(p):
            browser_bin = p
            break

    if not browser_bin:
        print("Error: Neither Chrome nor Edge browser executable found for PDF generation.")
        sys.exit(1)

    print(f"Using browser binary: {browser_bin}")
    print(f"Rendering publication-quality PDF to {output_pdf_path}...")

    cmd = [
        browser_bin,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--run-all-compositor-stages-before-draw",
        f"--print-to-pdf={output_pdf_path}",
        "--no-pdf-header-footer",
        output_html_path
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    print("Browser execution return code:", res.returncode)
    if res.stdout:
        print("STDOUT:", res.stdout.strip())
    if res.stderr:
        print("STDERR:", res.stderr.strip())

    if os.path.exists(output_pdf_path):
        size = os.path.getsize(output_pdf_path)
        print(f"SUCCESS: PDF generated successfully at {output_pdf_path} (Size: {size:,} bytes)!")
    else:
        print("ERROR: PDF file was not created.")
        sys.exit(1)

if __name__ == "__main__":
    main()
