<h1 align="center">ModelResolver – Relink missing models and download from HuggingFace/CivitAI</h1>

<p align="center"><i>ModelResolver is a powerful ComfyUI extension for automatically resolving missing models in loaded workflows. It features intelligent local fuzzy matching, direct cloud downloads, background download tracking, and automated in-place workflow updating.</i></p>

> [!WARNING]
> **WIP (Work in Progress) — Download and use at your own risk!**
> This project is still under active development and some features may be unfinished or contain bugs.

<p align="center">
  <img alt="ComfyUI" src="https://img.shields.io/badge/ComfyUI-1a1a1a?style=for-the-badge&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAcCAMAAABF0y+mAAAASFBMVEVHcEwYLtsYLtkXLtkXLdkYLtkWLdcFIdoAD95uerfI1XLR3mq3xIP8/yj0/zvw/0FSYMP5/zKMmKQtPNOuuozj8FOhrZW7x4FMWFFbAAAABnRSTlMAUrPX87KxijklAAAA00lEQVR4AX3SBw6DMAxA0UzbrIzO+9+02GkEpoWP9hPZZs06Hw75aI3k4W/+wkQtnGZNhF1I34BzalQcxkmasY0b9raklNcvLYU1GNiiOeVWauOa/XS526gRyzpV/7HeUOG9Jp6vcsvUrCPeKg/3KBKBQhoTD1dQggPWzPVfFOIgo85/kR4y6oB/8SlIEh7wvmTuKd3wgLVW1sTfRBoR7oWVqy/U2NcrWDYMINE7NUuJuoV+2fhaWmnbjzcOWnRv7XbiLh/Y9dNUqk2y0QcNwTu7wgf+/BhsPUhf4QAAAABJRU5ErkJggg==" />
  <img alt='GitHub Clones' src='https://img.shields.io/badge/dynamic/json?color=2F80ED&label=Clone&query=count&url=https://gist.githubusercontent.com/Azornes/2730ed6bbf240f06efd0c183bddd3d6c/raw/clone.json&logo=github&style=for-the-badge'></a>
  <a href="https://visitorbadge.io/status?path=https%3A%2F%2Fgithub.com%2FAzornes%2FComfyui-Resolution-Master">
    <img src="https://api.visitorbadge.io/api/combined?path=https%3A%2F%2Fgithub.com%2FAzornes%2FComfyui-Model-Resolver&countColor=%2337d67a&style=for-the-badge&labelStyle=none" /></a>
  <img alt="Python 3.10+" src="https://img.shields.io/badge/-Python_3.10+-4B8BBE?logo=python&logoColor=FFFFFF&style=for-the-badge&logoWidth=20">
  <img alt="JavaScript" src="https://img.shields.io/badge/-JavaScript-000000?logo=javascript&logoColor=F7DF1E&style=for-the-badge&logoWidth=20">
  <a href="https://github.com/sponsors/Azornes"><img src="https://img.shields.io/badge/Sponsor-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white" alt="Sponsor"><img src="https://img.shields.io/badge/-%20-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"></a>
</p>

<p align="center">
  <strong>🔹 <a href="#%EF%B8%8F-installation">Quick Start</a></strong>
  &nbsp; | &nbsp;
  <strong>⚙️ <a href="#-configuration--credentials-settings">Configuration</a></strong>
</p>

---

## 🚀 Key Features

- **🔍 Intelligent Fuzzy Matching**: Scans local ComfyUI model directories and looks for similar files (ignoring case, extensions, or minor naming differences) with similarity confidence scores.
- **☁️ Multi-Source Cloud Downloader**: Searches for and downloads missing files from **CivitAI**, **HuggingFace**, **CivArchive**, **Lora Manager Archive**, and the **ComfyUI-Manager** model database.
- **🔄 In-Place Workflow Updater**: Safely replaces model names and paths in your current workflow (supporting nested subgraphs and custom nodes like *rgthree's Power Lora Loader* or *LoraManager*).
- **📥 Background Download Manager**: Downloads models asynchronously directly to the correct directories (`checkpoints`, `loras`, `vae`, etc.) with speed tracking, file size display, progress bars, and cancel support.
- **🕵️ Loaded Models Inspector**: A dedicated tab displaying all models used in the active workflow, including their strength, physical paths, and disk availability status.
- **📂 Open Containing Folder**: Quickly opens Windows Explorer and selects/highlights the model file directly from the interface.

---

## 🛠️ How It Works (Step-by-Step)

1. **Load Workflow**: Load any workflow JSON or image into ComfyUI.
2. **Detection**: If the workflow references model files that are missing from your directories, the extension alerts you immediately.
3. **Resolve**:
   - **Local Search**: Click the local search button to find similar filenames you already have on disk (e.g., if they were moved to a different subfolder).
   - **Online Search**: If the file isn't on disk, search for it online (e.g., on CivitAI via its SHA256 file hash or text search).
4. **Download or Link**:
   - Click **Download** to asynchronously download the model in the background directly into the correct ComfyUI folder.
   - Or select a local alternative suggested by the Fuzzy Matching algorithm.
5. **Apply**: Click the apply button to update the ComfyUI workflow with the new, correct model paths. You're ready to click *Queue Prompt*!

---

## 📂 Supported Nodes & Model Types

Model Resolver supports standard ComfyUI mechanisms as well as custom implementations of popular loader nodes:
* **Standard loaders**: CheckpointLoader, LoraLoader, VAELoader, ControlNetLoader, UpscaleModelLoader, etc.
* **Advanced loaders**: Nodes from the `LoraManager` suite (`LoraLoaderV2`, `Lora Loader`, `Lora Stacker`), `rgthree` (`Power Lora Loader`), and LTX-Video nodes.
* **Subgraphs**: Full support for scanning and updating nodes inside nested group subgraphs.

---

## ⚙️ Configuration & Credentials (Settings)

In the extension settings panel, you can configure API keys and authorization tokens, which are required for downloading private models or files requiring authentication:
* **CivitAI API Key & Session Token**: Allows downloading models from CivitAI (including those marked as NSFW or requiring accepted terms of service).
* **HuggingFace Token**: Required for downloading gated or private models from HuggingFace.
* **Brave Search API Key**: An optional key used as a fallback search mechanism to discover HuggingFace download links via Brave search.

> [!TIP]
> The extension includes a built-in connection tester that allows you to instantly verify the validity of your tokens directly in the settings panel.

---

## ⚡ Installation

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
   git clone https://github.com/Azornes/comfyui-model-resolver.git
   ```
3. Start or restart ComfyUI. The extension will automatically install any missing dependencies (`requests`, `aiohttp`) and load the web interface.

---

## 📝 Requirements

* Python 3.10 or newer
* Libraries: `requests`, `aiohttp` (installed automatically if missing)
* Modern web browser with JS support (Chrome, Edge, Firefox, Brave)

---

## 📜 License

This project is licensed under the MIT License. Feel free to use, modify, and distribute.

---

## 💖 Support / Sponsorship

* ⭐ **Give a star** — it means a lot to me!
* 🐛 **Report a bug** or suggest a feature.
* 💖 **Support my work**:
  👉 [GitHub Sponsors](https://github.com/sponsors/Azornes)
