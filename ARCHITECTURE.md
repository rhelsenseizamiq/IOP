# 🏗️ IOP (Infrastructure Operations Platform) — Visual Architecture & Design Document

> **Project:** IOP (Infrastructure Operations Platform)  
> **Repository:** [rhelsenseizamiq/IOP](https://github.com/rhelsenseizamiq/IOP)  
> **Author:** Zamiq Mustafayev  

---

## 🖼️ Visual Architecture Diagrams

### 1. Detailed System & Component Architecture Diagram
![IOP Detailed Architecture Diagram](docs/iop_detailed_architecture_diagram.jpg)

### 2. High-Level Operations Overview Diagram
![IOP High-Level Architecture Diagram](docs/iop_architecture_diagram.jpg)

---

## 📐 High-Level System Architecture

```mermaid
graph TB
    subgraph ClientLayer ["Client & Presentation Layer"]
        User["Client Browser"]
    end

    subgraph EdgeLayer ["Edge & Proxy Layer (Docker: iop-nginx)"]
        Nginx["Nginx Reverse Proxy (Port 80/443)<br/>• TLS Termination<br/>• Static Asset Serving<br/>• REST API Proxying"]
    end

    subgraph FrontendApp ["Frontend Application (Docker: iop-frontend)"]
        ReactSPA["React 18 SPA (Vite + TS)<br/>• Ant Design 5 UI<br/>• Recharts Visualizations<br/>• Axios HTTP Client"]
    end

    subgraph BackendApp ["Backend API Service (Docker: iop-api)"]
        FastAPI["FastAPI App (Python 3.11 / Uvicorn)<br/>• Async Engine (Motor)<br/>• Pydantic v2 Schemas<br/>• JWT & LDAP Auth"]
        
        subgraph CoreRouters ["API Routers"]
            AuthRouter["Auth & Users Router"]
            IpamRouter["IPAM & Subnets Router"]
            PaloAltoRouter["PaloAlto Check Router"]
            VaultRouter["Password Vault Router"]
            IntegrationRouter["Integrations & Sync Router"]
        end

        subgraph CoreServices ["Background & Core Services"]
            SyncEngine["Nightly Sync Engine"]
            ScannerEngine["Network Scan & Ping Engine"]
            VaultEngine["AES-256 Vault Engine"]
        end
    end

    subgraph DataLayer ["Data & Storage Layer (Docker: iop-mongodb)"]
        Mongo["MongoDB 7.0 (ipam Database)<br/>• Subnets & Prefixes<br/>• IP Records & History<br/>• Vault Cabinets (Encrypted)<br/>• Audit Logs"]
    end

    subgraph ExternalIntegrations ["External Infrastructure Services"]
        PaloAlto["PaloAlto Firewall API"]
        Device42["Device42 IPAM"]
        Zabbix["Zabbix Monitoring"]
        vSphere["VMware vCenter"]
        LDAP["LDAP / Active Directory"]
    end

    User -->|HTTPS| Nginx
    Nginx -->|Serve SPA| ReactSPA
    Nginx -->|Proxy /api| FastAPI
    
    FastAPI --> AuthRouter
    FastAPI --> IpamRouter
    FastAPI --> PaloAltoRouter
    FastAPI --> VaultRouter
    FastAPI --> IntegrationRouter

    AuthRouter -->|Validate / Bind| LDAP
    IntegrationRouter --> SyncEngine
    PaloAltoRouter --> ScannerEngine

    SyncEngine -->|Fetch Data| Device42
    SyncEngine -->|Fetch Data| Zabbix
    SyncEngine -->|Fetch Data| vSphere
    SyncEngine -->|Trace / Traffic Log| PaloAlto
    ScannerEngine -->|ICMP / Port Check| ExternalIntegrations

    FastAPI -->|Async Motor Driver| Mongo

    classDef edge fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef app fill:#0f172a,stroke:#818cf8,stroke-width:2px,color:#fff;
    classDef data fill:#1e1b4b,stroke:#c084fc,stroke-width:2px,color:#fff;
    classDef ext fill:#14532d,stroke:#4ade80,stroke-width:2px,color:#fff;
    
    class Nginx edge;
    class FastAPI,ReactSPA app;
    class Mongo data;
    class PaloAlto,Device42,Zabbix,vSphere,LDAP ext;
```

---

## 🐳 Docker Deployment & Network Topology

```mermaid
graph LR
    subgraph Host ["Host OS (macOS / Linux)"]
        P80["Port 80 (HTTP)"]
        P443["Port 443 (HTTPS)"]
    end

    subgraph ExternalNet ["iop-external Network (Bridge)"]
        NginxService["iop-nginx (Nginx 1.25 Alpine)"]
        ApiService["iop-api (FastAPI Container)"]
    end

    subgraph InternalNet ["iop-internal Network (Isolated Bridge)"]
        FrontendBuild["iop-frontend"]
        MongoService["iop-mongodb (Mongo 7.0)"]
    end

    subgraph StorageVolumes ["Persistent Volumes"]
        VolData["mongodb_data"]
        VolConfig["mongodb_config"]
    end

    P80 --> NginxService
    P443 --> NginxService

    NginxService <-->|Reverse Proxy| ApiService
    NginxService <-->|Internal Assets| FrontendBuild

    ApiService <-->|DB Connections| MongoService
    MongoService --- VolData
    MongoService --- VolConfig

    ApiService -.->|Outbound Integrations| ExtNetwork["External Enterprise Network"]
```

---

## 🔄 Core Data & Operations Workflows

### 1. Authentication & Authorization Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Nginx
    participant FastAPI as FastAPI Auth Router
    participant LDAP as LDAP/AD Server
    participant Mongo as MongoDB

    User->>Nginx: POST /api/v1/auth/login (Username + Password)
    Nginx->>FastAPI: Forward Request
    alt LDAP Authentication Enabled
        FastAPI->>LDAP: Bind User Credentials
        LDAP-->>FastAPI: Success / Failure
    else Local Authentication
        FastAPI->>Mongo: Fetch User Document & Password Hash
        Mongo-->>FastAPI: User Record
        FastAPI->>FastAPI: Verify Passlib / Bcrypt Hash
    end
    FastAPI->>FastAPI: Issue Signed JWT (HS256) Access + Refresh Token
    FastAPI-->>Nginx: Return JWT Payload & HTTP Cookies
    Nginx-->>User: 200 OK (JWT Token)
```

### 2. Nightly Synchronization Workflow

```mermaid
sequenceDiagram
    autonumber
    participant Scheduler as Background Cron/Task
    participant SyncEngine as IOP Sync Engine
    participant Device42 as Device42 API
    participant Zabbix as Zabbix API
    participant vSphere as vCenter API
    participant Mongo as MongoDB

    Scheduler->>SyncEngine: Trigger Nightly Sync (02:00 AM)
    
    par Sync Device42
        SyncEngine->>Device42: Pull Subnets & IP Allocations
        Device42-->>SyncEngine: Subnet Records
    and Sync Zabbix
        SyncEngine->>Zabbix: Pull Monitored Hosts & Interfaces
        Zabbix-->>SyncEngine: Host Details
    and Sync vCenter
        SyncEngine->>vSphere: Pull VM Power States & IP Mappings
        vSphere-->>SyncEngine: VM Status Data
    end

    SyncEngine->>SyncEngine: Merge Multi-Source Enriched Metadata
    SyncEngine->>Mongo: Bulk Upsert IP Records & Subnet Hierarchy
    SyncEngine->>Mongo: Log Sync Health (Duration, Records Updated, Overdue Status)
```

---

## 🛡️ Security & Role-Based Access Control (RBAC) Matrix

| Role | Core IPAM Data | PaloAlto / Network Scans | Integrations (Discover/Import) | Vault Management |
| :--- | :--- | :--- | :--- | :--- |
| **Viewer** | 👁️ Read-Only | 🚫 Restricted | 🚫 Disabled | 🔑 Own Cabinets Only |
| **Operator** | 👁️ Read-Only | ⚡ Execute Scans & PaloAlto Check | 🚫 Disabled (View Only) | 🔑 Own Cabinets + Folder Management |
| **Administrator**| ✏️ Full Read/Write | ⚡ Full Access & Bulk Scans | 🚫 Disabled (View Only) | 🔑 Cabinet CRUD & Sharing |
| **SuperAdmin** | 👑 Full Access | 👑 Full Access | 🚀 Execute Discover / Import | 🔓 Delete Any Cabinet |

---

## 🔐 Password Vault Encryption Architecture

```mermaid
graph TD
    MasterKey["VAULT_MASTER_KEY (.env / Environment)"] --> KDF["AES-256-GCM Cryptographic Engine"]
    UserSecret["Plaintext Password Entry"] --> KDF
    KDF --> EncryptedPayload["Ciphertext + Nonce + Auth Tag"]
    EncryptedPayload -->|Stored in DB| Mongo["MongoDB (Vault Collection)"]
```

---

## 🧰 Technology Stack Summary

* **Frontend Framework:** React 18, Vite, TypeScript, Ant Design 5, Recharts, Tailwind CSS.
* **Backend Framework:** Python 3.11, FastAPI, Motor (Async MongoDB Driver), Pydantic v2.
* **Database Engine:** MongoDB 7.0 (`ipam` database).
* **Reverse Proxy & TLS:** Nginx 1.25 Alpine with dual-network isolation.
* **Authentication:** JWT (HS256) with optional LDAP/AD binding (`ldap3`).
* **Security:** AES-256-GCM Password Vault encryption, rate-limiting (`limits`), CORS enforcement, non-root container isolation.
