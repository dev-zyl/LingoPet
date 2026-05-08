import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface PetManifest {
  id: string;
  displayName: string;
  description: string;
  spritesheetPath: string;
  kind?: string;
  version?: string;
}

const importBtn = document.getElementById("import-btn") as HTMLButtonElement;
const importStatus = document.getElementById("import-status") as HTMLParagraphElement;
const petListEl = document.getElementById("pet-list") as HTMLDivElement;
const emptyState = document.getElementById("empty-state") as HTMLParagraphElement;

async function loadPetList(): Promise<void> {
  try {
    const pets = await invoke<PetManifest[]>("list_pets");
    petListEl.innerHTML = "";
    if (pets.length === 0) {
      emptyState.style.display = "block";
      return;
    }
    emptyState.style.display = "none";
    for (const pet of pets) {
      const card = document.createElement("div");
      card.className = "pet-card";
      card.innerHTML = `
        <h3>${pet.displayName}</h3>
        <p class="pet-id">${pet.id}</p>
        <p class="pet-desc">${pet.description}</p>
      `;
      petListEl.appendChild(card);
    }
  } catch (e) {
    console.error("Failed to load pet list:", e);
  }
}

async function importPet(): Promise<void> {
  importStatus.textContent = "";
  importBtn.disabled = true;

  try {
    const file = await open({
      multiple: false,
      filters: [{ name: "Pet Pack", extensions: ["zip"] }],
    });

    if (!file) {
      importBtn.disabled = false;
      return;
    }

    importStatus.textContent = "Importing...";
    const manifest = await invoke<PetManifest>("import_pet_zip", {
      zipPath: file,
    });

    importStatus.textContent = `Imported: ${manifest.displayName}`;
    await loadPetList();
  } catch (e: any) {
    importStatus.textContent = `Error: ${e}`;
    console.error("Import failed:", e);
  } finally {
    importBtn.disabled = false;
  }
}

importBtn.addEventListener("click", importPet);
loadPetList();
