<h1 align="center">Model-Resolver</h1>

<p align="center"><i>Find missing models in ComfyUI, download them from supported sources, and update workflow paths.</i></p>

<p align="center">
  <a href='https://registry.comfy.org/publishers/azornes/nodes/comfyui-model-resolver'><img alt='ComfyUI' src='https://img.shields.io/badge/ComfyUI-1a1a1a?style=for-the-badge&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAASFBMVEVHcEwYLtsYLtkXLtkXLdkYLtkWLdcFIdoAD95uerfI1XLR3mq3xIP8/yj0/zvw/0FSYMP5/zKMmKQtPNOuuozj8FOhrZW7x4FMWFFbAAAABnRSTlMAUrPX87KxijklAAAA00lEQVR4AX3SBw6DMAxA0UzbrIzO+9+02GkEpoWP9hPZZs06Hw75aI3k4W/+wkQtnGZNhF1I34BzalQcxkmasY0b9raklNcvLYU1GNiiOeVWauOa/XS526gRyzpV/7HeUOG9Jp6vcsvUrCPeKg/3KBKBQhoTD1dQggPWzPVfFOIgo85/kR4y6oB/8SlIEh7wvmTuKd3wgLVW1sTfRBoR7oWVqy/U2NcrWDYMINE7NUuJuoV+2fhaWmnbjzcOWnRv7XbiLh/Y9dNUqk2y0QcNwTu7wgf+/BhsPUhf4QAAAABJRU5ErkJggg=='><img alt='Downloads' src='https://img.shields.io/badge/dynamic/json?color=%230D2A4A&label=&query=downloads&url=https://gist.githubusercontent.com/Azornes/741c965c0e0504ac65935dcc105a4ad8/raw/top_modelresolver.json&style=for-the-badge'></a>  
  <img alt='GitHub Clones' src='https://img.shields.io/badge/dynamic/json?color=2F80ED&label=Clone&query=count&url=https://gist.githubusercontent.com/Azornes/2730ed6bbf240f06efd0c183bddd3d6c/raw/clone.json&logo=github&style=for-the-badge&labelColor=1a1a1a'></a>
  <a href="https://visitorbadge.io/status?path=https%3A%2F%2Fgithub.com%2FAzornes%2FComfyui-Resolution-Master">
    <img src="https://api.visitorbadge.io/api/combined?path=https%3A%2F%2Fgithub.com%2FAzornes%2FComfyui-Model-Resolver&countColor=%03ae5f&style=for-the-badge&labelStyle=none&labelColor=1a1a1a" /></a>
  <img alt="Python 3.10+" src="https://img.shields.io/badge/Python-3.10+-2564ae?labelColor=1a1a1a&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMTAiIGhlaWdodD0iMTEwIiB2aWV3Qm94PSIwLjIxIC0wLjA3NyAxMTAgMTEwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImEiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4MT0iNjMuODE1OSIgeTE9IjU2LjY4MjkiIHgyPSIxMTguNDkzNCIgeTI9IjEuODIyNSIgZ3JhZGllbnRUcmFuc2Zvcm09Im1hdHJpeCgxIDAgMCAtMSAtNTMuMjk3NCA2Ni40MzIxKSI%2BPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMzg3RUI4Ii8%2BPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMzY2OTk0Ii8%2BPC9saW5lYXJHcmFkaWVudD48bGluZWFyR3JhZGllbnQgaWQ9ImIiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4MT0iOTcuMDQ0NCIgeTE9IjIxLjYzMjEiIHgyPSIxNTUuNjY2NSIgeTI9Ii0zNC41MzA4IiBncmFkaWVudFRyYW5zZm9ybT0ibWF0cml4KDEgMCAwIC0xIC01My4yOTc0IDY2LjQzMjEpIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNGRkUwNTIiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGRkMzMzEiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cGF0aCBmaWxsPSJ1cmwoI2EpIiBkPSJNNTUuMDIzLTAuMDc3Yy0yNS45NzEsMC0yNi4yNSwxMC4wODEtMjYuMjUsMTIuMTU2djEyLjU5NGgyNi43NXYzLjc4MUgxOC4xNDhjLTcuOTQ5LDAtMTcuOTM4LDQuODMzLTE3LjkzOCwyNi4yNSwwLDE5LjY3Myw3Ljc5MiwyNy4yODEsMTUuNjU2LDI3LjI4MWg5LjM0NFY2OC44NmMwLTUuNDkxLDIuNzIxLTE1LjY1NiwxNS40MDYtMTUuNjU2aDI2LjUzMWMzLjkwMiwwLDE0LjkwNi0xLjY5NiwxNC45MDYtMTQuNDA2VjE0LjU3OWMuMDAxLTMuMTUzLS41MzgtMTQuNjU2LTI3LjAzLTE0LjY1NnpNNDAuMjczLDguMzkyYzIuNjYyLDAsNC44MTMsMi4xNSw0LjgxMyw0LjgxMywwLDIuNjYxLTIuMTUxLDQuODEzLTQuODEzLDQuODEzcy00LjgxMy0yLjE1MS00LjgxMy00LjgxM2MwLTIuNjYzLDIuMTUxLTQuODEzLDQuODEzLTQuODEzeiIvPjxwYXRoIGZpbGw9InVybCgjYikiIGQ9Ik01NS4zOTcsMTA5LjkyM2MyNS45NTksMCwyNi4yODItMTAuMjcxLDI2LjI4Mi0xMi4xNTZWODUuMTczSDU0Ljg5N3YtMy43ODFoMzcuMzc1YzguMDA5LDAsMTcuOTM4LTQuOTU0LDE3LjkzOC0yNi4yNSwwLTIzLjMyMi0xMC41MzgtMjcuMjgxLTE1LjY1Ni0yNy4yODFIODUuMjF2MTMuMTI1YzAsNS40OTEtMi42MzEsMTUuNjU2LTE1LjQwNiwxNS42NTZINDMuMjcyYy0zLjg5MiwwLTE0LjkwNiwxLjg5Ni0xNC45MDYsMTQuNDA2djI0LjIxOWMwLDUuMjMsMy4xOTYsMTQuNjU2LDI3LjAzMSwxNC42NTZ6TTcwLjE0OCwxMDEuNDU0Yy0yLjY2MiwwLTQuODEzLTIuMTUxLTQuODEzLTQuODEzczIuMTUtNC44MTMsNC44MTMtNC44MTNjMi42NjEsMCw0LjgxMywyLjE1MSw0LjgxMyw0LjgxM3MtMi4xNTIsNC44MTMtNC44MTMsNC44MTN6Ii8%2BPC9zdmc%2B&style=for-the-badge">
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-1a1a1a?style=for-the-badge&logo=javascript&logoColor=F7DF1E&labelColor=1a1a1a">
  <a href="https://github.com/sponsors/Azornes" style="display: inline-flex; align-items: center; white-space: nowrap;">
    <img src="https://img.shields.io/badge/Sponsor-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=magenta&labelColor=1a1a1a" alt="Sponsor"></a>
  <a href="https://ko-fi.com/azornes" style="display: inline-flex; align-items: center; white-space: nowrap;">
    <img src="https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-Fi"></a>
</p>
<p align="center">
  <strong>🔹 <a href="#installation">Quick Start</a></strong>
  &nbsp; | &nbsp;
  <strong>⚙️ <a href="#configuration--settings">Configuration</a></strong>
</p>

https://github.com/user-attachments/assets/f5d83ce9-3ea8-4532-9b96-4ca4cd6cfb75

---

## Key Features

- **Find local matches.** ModelResolver scans ComfyUI model directories and compares missing filenames with files on disk. It ignores case, extensions, and small naming changes, then shows a similarity score.
- **Search supported sources.** Find files on CivitAI, Hugging Face, CivArchive, Lora Manager Archive, and the ComfyUI-Manager model database.
- **Update workflows.** Replace model names and paths in the active workflow, including nested subgraphs and loaders from rgthree's Power Lora Loader and LoraManager.
- **Manage downloads.** Send files to their model folders, track speed and progress, and cancel or pause downloads when the selected backend supports it.
- **Inspect loaded models.** Review the models used by the active workflow, their physical paths, strength values, and disk status.
- **Open model folders.** Reveal a model file in the host file manager when the platform supports that action.
- **Use custom URLs.** Download a file from any direct URL and choose its target folder and filename.

---

## How It Works (Step-by-Step)

1. **Load Workflow**: Load any workflow JSON or image into ComfyUI.
2. **Open Model Resolver**: Open the Model Resolver interface using one of these options:
   * Click the **Model Resolver** tab icon in the ComfyUI sidebar (or the menu/topbar button in older ComfyUI versions).
   * Press the default keyboard shortcut `Ctrl + Shift + |`.
   * Add a **Model Resolver Opener** node to your canvas and click its **Open Model Resolver** button.
   * Search for `Open Model Resolver` in the ComfyUI Command Palette.
3. **Detection**: Once opened, the extension automatically scans your active workflow, checks your local directories, and lists any referenced models that are missing on disk.
4. **Resolve**:
   * **Local Search**: Click the search icon next to a missing model to find similar filenames already on your disk (e.g., if you renamed a file or moved it to a different subfolder).
   * **Online Search**: If the file isn't on disk, search for it online (e.g., on CivitAI via its SHA256 hash or text search, or on HuggingFace).
5. **Download or Link**:
   * Click **Download** to asynchronously download the model in the background directly into the correct category folder.
   * Or select a local alternative suggested by the Fuzzy Matching algorithm.
6. **Apply**: Click **Apply** to update the ComfyUI workflow nodes with the new, correct model paths. You're ready to click *Queue Prompt*!

---

## Supported Nodes & Model Types

Model Resolver supports standard ComfyUI mechanisms as well as custom implementations of popular loader nodes:
* **Standard loaders**: CheckpointLoader, LoraLoader, VAELoader, ControlNetLoader, UpscaleModelLoader, etc.
* **Advanced loaders**: Nodes from the [LoraManager](https://github.com/willmiao/ComfyUI-Lora-Manager) suite (`LoraLoaderV2`, `Lora Loader`, `Lora Stacker`), [rgthree](https://github.com/rgthree/rgthree-comfy) (`Power Lora Loader`), and [LTX-Video](https://github.com/Lightricks/ComfyUI-LTXVideo) nodes.
* **Subgraphs**: Full support for scanning and updating nodes inside nested group subgraphs.

---

## Downloader Backends

Model Resolver provides two download engines in the Settings panel and an automatic Hugging Face Xet transport for eligible files:

| Backend / transport | How it is selected | Live progress | Cancel | Pause / resume |
| --- | --- | --- | --- | --- |
| **Python** | Selected in Settings; also used as the general fallback | Yes | Yes | No |
| **Aria2 (Recommended)** | Selected in Settings | Yes | Yes | Yes |
| **Hugging Face Xet** | Activated automatically for Xet-backed Hugging Face files while the Python engine is selected | Yes, using native Xet updates | Yes | No |

### Python Engine

* Works out of the box without external downloader binaries.
* Supports authenticated Hugging Face and CivitAI requests, live speed and ETA, and cancellation with partial-file cleanup.

### Aria2 Engine

* High-performance, multi-connection downloader for large files.
* Splits downloads across multiple connections (up to 16 connections/splits).
* Safely forwards target cookies, headers, and authentication tokens.
* Supports cancelling, pausing, and resuming partial downloads.

### Hugging Face Xet Transport

* Uses the official `huggingface-hub` and `hf-xet` packages for files stored with Hugging Face Xet.
* Starts automatically when the Python engine is selected and the Hugging Face response includes Xet metadata. If Xet is unavailable or the file is not Xet-backed, Model Resolver falls back to the regular Python downloader.
* Reports native transfer progress, network speed, and ETA approximately every 200 ms. The progress display uses the known final file size from Hugging Face metadata.
* Writes an in-progress download to a temporary `.xet-part` file. Cancelling stops the native Xet task and removes this partial file.
* May briefly show **Finalizing** after the network transfer while Xet reconstructs and writes the final model file.

> [!NOTE]
> Xet transfers compressed, deduplicated data. The received byte count can stay below the final model size, so a download can reach **Finalizing** before the network counter reaches the final size.

> [!TIP]
> Install and configure Aria2 from the Settings panel. ModelResolver downloads the official release for your operating system and architecture, extracts it, and manages the background daemon. The daemon starts when a download needs it and stops after it stays idle.

---

## Dynamic path templates

Use model metadata to build download paths. The **Download Path Mode** setting provides three options:

- `suggested`: choose a subfolder category from the available metadata.
- `manual`: use your custom path mapping.
- `template`: build a relative path with template variables.

### Template variables

- `{base_model}`: base architecture such as `SD 1.5`, `SDXL`, or `Flux`. **Base Model Path Mappings** can rename values such as `sd1.5` and `flux1`.
- `{author}`: creator name or Hugging Face repository publisher.
- `{first_tag}`: primary model tag, selected from categories such as `style`, `concept`, and `character`.
- `{model_name}`: cleaned model name or file stem.
- `{version_name}`: release version such as `v1.0`.

### Default templates

- **Loras:** `{base_model}/{first_tag}`
- **Checkpoints:** `{base_model}`
- **Embeddings:** `{base_model}`

For example, a Lora can use `Loras/SDXL/style/my_lora_v1.safetensors`, while a checkpoint can use `Checkpoints/Flux/my_flux_model.safetensors`.


---

## Configuration & Settings

Open Settings to add credentials for downloads and searches:

- **CivitAI API key and session token:** download NSFW models and files that require accepted terms.
- **Hugging Face access token:** download files from gated or private repositories.
- **Brave Search API key:** find public or gated Hugging Face download links through fallback search.

The Settings panel includes **Check** buttons for each credential type. Use them to verify a key or token before starting a download.

---

## Loaded Models Inspector & Local Hashing

* **Loaded Models Tab**: Check what models are loaded in the current active python session. It lists paths, model categories, byte sizes, physical existence checks, and confidence levels.
* **Open Containing Folder**: Select a model in the Loaded Models tab and click the folder icon to reveal it in the host system's file manager.
* **Local Hashing (`sha256`)**:
  * You can calculate the exact `sha256` hash of any local model file in the background.
  * Hashing status is updated in real-time, allowing you to use exact hash queries on CivitAI/CivArchive to retrieve model metadata and link files.

---

## Installation

### Install via ComfyUI-Manager
1. Search `ComfyUI Model Resolver` in ComfyUI-Manager and click the `Install` button.
2. Restart ComfyUI.

### Manual Install
1. Navigate to the `custom_nodes` folder in your ComfyUI installation:
   ```bash
   cd ComfyUI/custom_nodes/
   ```
2. Clone this repository:
   ```bash
   git clone https://github.com/Azornes/Comfyui-Model-Resolver.git
   ```
3. Enter the repository:
   ```bash
   cd Comfyui-Model-Resolver
   ```
4. Install the required dependencies:
   * **For Windows Portable Version:**
      ```bash
      ..\..\..\python_embeded\python.exe -m pip install -r requirements.txt
      ```
   * **For standard Python/virtual environment installations:**
    Activate the same Python environment used by ComfyUI, then run:
     ```bash
     pip install -r requirements.txt
     ```
5. Start or restart ComfyUI.

---

## Requirements

* Python 3.10 or newer
* Libraries: `requests`, `aiohttp`, `rapidfuzz`, `huggingface-hub`
* Modern web browser with JS support (Chrome, Edge, Firefox, Brave)

## Backend Architecture

The ComfyUI entry point stays small. Runtime state lives in `core/extension.py`, route registration lives in `core/routes/registry.py`, HTTP adapters live in `core/routes/`, and shared feature logic lives in `core/services/`.

See [`docs/architecture.md`](docs/architecture.md) for the dependency flow and local verification commands.

---

## License

This project is licensed under the MIT License. Feel free to use, modify, and distribute.

---

## Support / Sponsorship

- Star the repository if ModelResolver helps your workflows.
- [Report a bug](https://github.com/Azornes/Comfyui-Model-Resolver/issues) or suggest a feature.
- Support the project through [GitHub Sponsors](https://github.com/sponsors/Azornes) or [Ko-fi](https://ko-fi.com/azornes).
