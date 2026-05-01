# Page Components

<cite>
**Referenced Files in This Document**
- [HomePage.tsx](file://packages/web/src/pages/HomePage.tsx)
- [SendPage.tsx](file://packages/web/src/pages/SendPage.tsx)
- [ReceivePage.tsx](file://packages/web/src/pages/ReceivePage.tsx)
- [LoginPage.tsx](file://packages/web/src/pages/LoginPage.tsx)
- [P2PPage.tsx](file://packages/web/src/pages/P2PPage.tsx)
- [FileUploader.tsx](file://packages/web/src/components/FileUploader.tsx)
- [FolderUploader.tsx](file://packages/web/src/components/FolderUploader.tsx)
- [TextInput.tsx](file://packages/web/src/components/TextInput.tsx)
- [PickupCodeDisplay.tsx](file://packages/web/src/components/PickupCodeDisplay.tsx)
- [CodeInput.tsx](file://packages/web/src/components/CodeInput.tsx)
- [PeerCard.tsx](file://packages/web/src/components/PeerCard.tsx)
- [TransferProgressCard.tsx](file://packages/web/src/components/TransferProgressCard.tsx)
- [TransferRequestModal.tsx](file://packages/web/src/components/TransferRequestModal.tsx)
- [useP2P.ts](file://packages/web/src/hooks/useP2P.ts)
- [p2p.service.ts](file://packages/web/src/services/p2p.service.ts)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)
- [App.tsx](file://packages/web/src/App.tsx)
- [main.tsx](file://packages/web/src/main.tsx)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)

## Introduction
This document provides comprehensive documentation for Airportal's page-level components. It covers the main landing page, file/text upload workflows, download initiation and retrieval, authentication flow, and peer-to-peer transfer interface. The goal is to explain routing patterns, page transitions, error handling, and user experience optimizations for each page component.

## Project Structure
Airportal is a Vite + React + TypeScript single-page application organized into pages, components, services, hooks, stores, and shared types. Pages are routeable components that orchestrate user interactions and delegate to reusable components and services.

```mermaid
graph TB
subgraph "Pages"
HP["HomePage.tsx"]
SP["SendPage.tsx"]
RP["ReceivePage.tsx"]
LP["LoginPage.tsx"]
PP["P2PPage.tsx"]
end
subgraph "Components"
FU["FileUploader.tsx"]
TU["TextInput.tsx"]
CI["CodeInput.tsx"]
PCD["PickupCodeDisplay.tsx"]
PC["PeerCard.tsx"]
TPC["TransferProgressCard.tsx"]
TRM["TransferRequestModal.tsx"]
end
subgraph "Services"
API["api.ts"]
P2PS["p2p.service.ts"]
end
subgraph "Hooks & Stores"
UP2P["useP2P.ts"]
STORE["useStore.ts"]
end
HP --> SP
HP --> RP
HP --> PP
SP --> FU
SP --> TU
RP --> CI
SP --> PCD
PP --> PC
PP --> TPC
PP --> TRM
SP --> API
RP --> API
LP --> API
PP --> UP2P
UP2P --> P2PS
SP --> STORE
RP --> STORE
LP --> STORE
```

**Diagram sources**
- [HomePage.tsx](file://packages/web/src/pages/HomePage.tsx)
- [SendPage.tsx](file://packages/web/src/pages/SendPage.tsx)
- [ReceivePage.tsx](file://packages/web/src/pages/ReceivePage.tsx)
- [LoginPage.tsx](file://packages/web/src/pages/LoginPage.tsx)
- [P2PPage.tsx](file://packages/web/src/pages/P2PPage.tsx)
- [FileUploader.tsx](file://packages/web/src/components/FileUploader.tsx)
- [TextInput.tsx](file://packages/web/src/components/TextInput.tsx)
- [CodeInput.tsx](file://packages/web/src/components/CodeInput.tsx)
- [PickupCodeDisplay.tsx](file://packages/web/src/components/PickupCodeDisplay.tsx)
- [PeerCard.tsx](file://packages/web/src/components/PeerCard.tsx)
- [TransferProgressCard.tsx](file://packages/web/src/components/TransferProgressCard.tsx)
- [TransferRequestModal.tsx](file://packages/web/src/components/TransferRequestModal.tsx)
- [useP2P.ts](file://packages/web/src/hooks/useP2P.ts)
- [p2p.service.ts](file://packages/web/src/services/p2p.service.ts)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

**Section sources**
- [App.tsx](file://packages/web/src/App.tsx)
- [main.tsx](file://packages/web/src/main.tsx)

## Core Components
- HomePage: Main landing page with navigation to Send, Receive, and P2P flows. It reads user state from the global store to conditionally show history-related messaging.
- SendPage: Centralized file/text/folder upload workflow with configuration controls (expiry, max downloads, owner-only), validation feedback, and a post-upload pickup code display.
- ReceivePage: Download initiation via 6-character pickup code input, with distinct handling for text vs. file content and owner-only restrictions.
- LoginPage: Authentication toggle between login and register, form submission, token/user persistence, and navigation back to home.
- P2PPage: Local network device discovery, peer selection, real-time transfer coordination, and request handling without server intermediation.

**Section sources**
- [HomePage.tsx](file://packages/web/src/pages/HomePage.tsx)
- [SendPage.tsx](file://packages/web/src/pages/SendPage.tsx)
- [ReceivePage.tsx](file://packages/web/src/pages/ReceivePage.tsx)
- [LoginPage.tsx](file://packages/web/src/pages/LoginPage.tsx)
- [P2PPage.tsx](file://packages/web/src/pages/P2PPage.tsx)

## Architecture Overview
The pages coordinate with:
- Services for API calls and P2P signaling/transfer.
- Reusable components for input, display, and progress.
- A global store for user/session state and app configuration.
- Hooks encapsulating P2P lifecycle and state updates.

```mermaid
graph TB
subgraph "UI Layer"
HP["HomePage"]
SP["SendPage"]
RP["ReceivePage"]
LP["LoginPage"]
PP["P2PPage"]
end
subgraph "Shared Components"
FU["FileUploader"]
TU["TextInput"]
CI["CodeInput"]
PCD["PickupCodeDisplay"]
PC["PeerCard"]
TPC["TransferProgressCard"]
TRM["TransferRequestModal"]
end
subgraph "Domain Services"
API["transferApi"]
AUTH["authApi"]
P2PS["p2pService"]
end
subgraph "State"
STORE["useStore"]
HOOK["useP2P"]
end
HP --> |"Routes"| SP
HP --> |"Routes"| RP
HP --> |"Routes"| PP
SP --> FU
SP --> TU
SP --> PCD
RP --> CI
PP --> PC
PP --> TPC
PP --> TRM
SP --> |"upload"| API
RP --> |"getContent"| API
LP --> |"login/register"| AUTH
PP --> HOOK
HOOK --> P2PS
SP --> STORE
RP --> STORE
LP --> STORE
PP --> STORE
```

**Diagram sources**
- [HomePage.tsx](file://packages/web/src/pages/HomePage.tsx)
- [SendPage.tsx](file://packages/web/src/pages/SendPage.tsx)
- [ReceivePage.tsx](file://packages/web/src/pages/ReceivePage.tsx)
- [LoginPage.tsx](file://packages/web/src/pages/LoginPage.tsx)
- [P2PPage.tsx](file://packages/web/src/pages/P2PPage.tsx)
- [FileUploader.tsx](file://packages/web/src/components/FileUploader.tsx)
- [TextInput.tsx](file://packages/web/src/components/TextInput.tsx)
- [CodeInput.tsx](file://packages/web/src/components/CodeInput.tsx)
- [PickupCodeDisplay.tsx](file://packages/web/src/components/PickupCodeDisplay.tsx)
- [PeerCard.tsx](file://packages/web/src/components/PeerCard.tsx)
- [TransferProgressCard.tsx](file://packages/web/src/components/TransferProgressCard.tsx)
- [TransferRequestModal.tsx](file://packages/web/src/components/TransferRequestModal.tsx)
- [useP2P.ts](file://packages/web/src/hooks/useP2P.ts)
- [p2p.service.ts](file://packages/web/src/services/p2p.service.ts)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

## Detailed Component Analysis

### HomePage
- Purpose: Primary entry point offering quick actions to Send, Receive, and P2P.
- Navigation: Uses router links to navigate to respective routes.
- User state: Reads user presence from the store to tailor messaging.

Key behaviors:
- Conditional rendering of P2P entry based on configuration availability.
- Presence of user-aware hints about transfer history.

**Section sources**
- [HomePage.tsx](file://packages/web/src/pages/HomePage.tsx)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

### SendPage
- Purpose: Unified upload interface for files, folders, and text with configurable constraints.
- State management:
  - Tracks transfer type, expiry, max downloads, owner-only flag, loading/error states, and result.
  - Loads app configuration (e.g., max sizes) on mount.
- Workflows:
  - File upload: validates size, invokes upload endpoint, displays result.
  - Folder upload: zips files, uploads zip blob, displays result.
  - Text upload: trims and submits text, displays result.
- Post-upload: renders a dedicated pickup code display with countdown and copy actions.

Validation and UX:
- Size checks for files and folders.
- Owner-only toggle for logged-in users.
- Clear error messages mapped from API responses.
- Loading overlays during uploads.

**Section sources**
- [SendPage.tsx](file://packages/web/src/pages/SendPage.tsx)
- [FileUploader.tsx](file://packages/web/src/components/FileUploader.tsx)
- [FolderUploader.tsx](file://packages/web/src/components/FolderUploader.tsx)
- [TextInput.tsx](file://packages/web/src/components/TextInput.tsx)
- [PickupCodeDisplay.tsx](file://packages/web/src/components/PickupCodeDisplay.tsx)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

#### SendPage Upload Sequence
```mermaid
sequenceDiagram
participant U as "User"
participant SP as "SendPage"
participant FU as "FileUploader"
participant API as "transferApi"
U->>FU : "Select file"
FU-->>SP : "onUpload(file)"
SP->>SP : "setLoading(true), setError(null)"
SP->>API : "uploadFile(file, options)"
API-->>SP : "TransferResult or error"
alt success
SP->>SP : "setResult(result)"
else failure
SP->>SP : "setError(message)"
end
SP->>SP : "setLoading(false)"
```

**Diagram sources**
- [SendPage.tsx](file://packages/web/src/pages/SendPage.tsx)
- [FileUploader.tsx](file://packages/web/src/components/FileUploader.tsx)
- [api.ts](file://packages/web/src/services/api.ts)

### ReceivePage
- Purpose: Initiates download by accepting a 6-character pickup code.
- Input: CodeInput component handles digit-only input, auto-focus, paste, and submission.
- Retrieval logic:
  - Calls getContent with the code.
  - For text: copies to clipboard and alerts success.
  - For binary: creates a Blob URL, triggers a hidden anchor click, revokes URL.
- Error handling:
  - Distinguishes owner-only restriction errors (403) based on login state.
  - General API error messages fallback.

**Section sources**
- [ReceivePage.tsx](file://packages/web/src/pages/ReceivePage.tsx)
- [CodeInput.tsx](file://packages/web/src/components/CodeInput.tsx)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

#### ReceivePage Retrieval Flow
```mermaid
flowchart TD
Start(["User enters 6-digit code"]) --> Submit["Call getContent(code)"]
Submit --> Resp{"Response type?"}
Resp --> |Text| Copy["Copy text to clipboard"]
Copy --> Done(["Alert success"])
Resp --> |Binary| Blob["Create Object URL"]
Blob --> Click["Trigger anchor download"]
Click --> Revoke["Revoke Object URL"]
Revoke --> Done
Resp --> |Error| Err["Map 403 owner-only or generic error"]
Err --> Done
```

**Diagram sources**
- [ReceivePage.tsx](file://packages/web/src/pages/ReceivePage.tsx)
- [CodeInput.tsx](file://packages/web/src/components/CodeInput.tsx)
- [api.ts](file://packages/web/src/services/api.ts)

### LoginPage
- Purpose: Toggle between login and register forms, persist tokens/users, and redirect to home.
- Form handling:
  - Controlled inputs for username/password with min/max constraints.
  - Prevents submission while loading.
- Authentication flow:
  - Calls authApi.login or authApi.register depending on mode.
  - On success, sets token and user in the store, navigates to home.
  - Displays API error messages on failure.

**Section sources**
- [LoginPage.tsx](file://packages/web/src/pages/LoginPage.tsx)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

#### LoginPage Authentication Sequence
```mermaid
sequenceDiagram
participant U as "User"
participant LP as "LoginPage"
participant AUTH as "authApi"
participant STORE as "useStore"
U->>LP : "Toggle mode (login/register)"
U->>LP : "Submit form"
LP->>AUTH : "login(username,password) or register(username,password)"
AUTH-->>LP : "Result {token,user} or error"
alt success
LP->>STORE : "setToken(token), setUser(user)"
LP->>LP : "navigate('/')"
else failure
LP->>LP : "setError(message)"
end
```

**Diagram sources**
- [LoginPage.tsx](file://packages/web/src/pages/LoginPage.tsx)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

### P2PPage
- Purpose: Local network file transfer without server intermediation.
- Discovery and state:
  - useP2P hook manages connection, peer list, pending requests, and transfer progress.
  - Renders PeerCard entries for discovered peers.
- Transfers:
  - Selecting a peer opens a file picker; chosen file is sent to the peer.
  - Pending transfer requests are shown in a modal with accept/reject actions.
  - Active transfers are displayed with progress cards.
- UX:
  - Shows connection status and guidance when no peers are present.
  - Disables interactions during sending to prevent race conditions.

**Section sources**
- [P2PPage.tsx](file://packages/web/src/pages/P2PPage.tsx)
- [PeerCard.tsx](file://packages/web/src/components/PeerCard.tsx)
- [TransferProgressCard.tsx](file://packages/web/src/components/TransferProgressCard.tsx)
- [TransferRequestModal.tsx](file://packages/web/src/components/TransferRequestModal.tsx)
- [useP2P.ts](file://packages/web/src/hooks/useP2P.ts)
- [p2p.service.ts](file://packages/web/src/services/p2p.service.ts)

#### P2PPage Interaction Flow
```mermaid
sequenceDiagram
participant U as "User"
participant PP as "P2PPage"
participant H as "useP2P"
participant S as "p2pService"
U->>PP : "Open P2PPage"
PP->>H : "Initialize (connect)"
H->>S : "connect()"
S-->>H : "init message (socketId)"
H-->>PP : "isConnected=true, peers updated"
U->>PP : "Select peer"
PP->>PP : "Open file picker"
U->>PP : "Choose file"
PP->>H : "sendFile(peerId, file)"
H->>S : "initiateTransfer(peerId, file)"
S-->>H : "progress events"
H-->>PP : "transfers updated"
S-->>H : "transfer completed"
H-->>PP : "status=completed"
```

**Diagram sources**
- [P2PPage.tsx](file://packages/web/src/pages/P2PPage.tsx)
- [useP2P.ts](file://packages/web/src/hooks/useP2P.ts)
- [p2p.service.ts](file://packages/web/src/services/p2p.service.ts)

## Dependency Analysis
- Pages depend on:
  - Components for input/display.
  - Services for API and P2P operations.
  - Store for user/session/configuration state.
- Hook useP2P encapsulates P2P service subscriptions and state updates, returning a concise API to pages.
- Components enforce validation and UX constraints close to the user input level.

```mermaid
graph LR
SP["SendPage"] --> FU["FileUploader"]
SP --> TU["TextInput"]
RP["ReceivePage"] --> CI["CodeInput"]
PP["P2PPage"] --> PC["PeerCard"]
PP --> TPC["TransferProgressCard"]
PP --> TRM["TransferRequestModal"]
SP --> API["transferApi"]
RP --> API
LP["LoginPage"] --> AUTH["authApi"]
PP --> HUP2P["useP2P"]
HUP2P --> P2PS["p2pService"]
SP --> STORE["useStore"]
RP --> STORE
LP --> STORE
PP --> STORE
```

**Diagram sources**
- [SendPage.tsx](file://packages/web/src/pages/SendPage.tsx)
- [ReceivePage.tsx](file://packages/web/src/pages/ReceivePage.tsx)
- [LoginPage.tsx](file://packages/web/src/pages/LoginPage.tsx)
- [P2PPage.tsx](file://packages/web/src/pages/P2PPage.tsx)
- [FileUploader.tsx](file://packages/web/src/components/FileUploader.tsx)
- [TextInput.tsx](file://packages/web/src/components/TextInput.tsx)
- [CodeInput.tsx](file://packages/web/src/components/CodeInput.tsx)
- [PeerCard.tsx](file://packages/web/src/components/PeerCard.tsx)
- [TransferProgressCard.tsx](file://packages/web/src/components/TransferProgressCard.tsx)
- [TransferRequestModal.tsx](file://packages/web/src/components/TransferRequestModal.tsx)
- [useP2P.ts](file://packages/web/src/hooks/useP2P.ts)
- [p2p.service.ts](file://packages/web/src/services/p2p.service.ts)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

**Section sources**
- [useP2P.ts](file://packages/web/src/hooks/useP2P.ts)
- [p2p.service.ts](file://packages/web/src/services/p2p.service.ts)
- [api.ts](file://packages/web/src/services/api.ts)
- [useStore.ts](file://packages/web/src/stores/useStore.ts)

## Performance Considerations
- Debounce or throttle rapid user interactions (e.g., code input) to avoid excessive re-renders.
- Lazy-load heavy components only when needed (e.g., P2PPage).
- Use virtualization for long lists of peers/transfers if scale grows.
- Minimize re-renders by passing memoized callbacks and stable references to child components.
- Avoid blocking UI during long-running operations; keep loading indicators responsive.

## Troubleshooting Guide
Common issues and resolutions:
- SendPage upload failures:
  - Verify file size constraints and network connectivity.
  - Check error messages returned by the API for specific reasons.
- ReceivePage 403 errors:
  - If not logged in, prompt login before attempting owner-only content.
  - If logged in but still blocked, inform that only the creator can claim.
- P2PPage no peers found:
  - Ensure devices are on the same local network and the page is open on peers.
  - Confirm connection to signaling server is established.
- LoginPage authentication errors:
  - Validate credentials meet minimum length requirements.
  - Confirm network availability and server reachability.

**Section sources**
- [SendPage.tsx](file://packages/web/src/pages/SendPage.tsx)
- [ReceivePage.tsx](file://packages/web/src/pages/ReceivePage.tsx)
- [P2PPage.tsx](file://packages/web/src/pages/P2PPage.tsx)
- [LoginPage.tsx](file://packages/web/src/pages/LoginPage.tsx)

## Conclusion
Airportal’s page components provide a cohesive, user-focused experience across file/text transfers, download retrieval, authentication, and local network P2P sharing. By leveraging reusable components, centralized services, and a global store, the pages maintain clean separation of concerns, robust error handling, and consistent UX patterns. The documented flows and diagrams serve as a guide for extending functionality, optimizing performance, and maintaining reliability.