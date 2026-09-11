const $ = (selector) => document.querySelector(selector);
const panels = ["#consent-panel", "#calibration-panel", "#task-panel", "#running-panel", "#submit-panel", "#complete-panel"];
let state = null;
function showStatus(message, error = false) { $("#status").textContent = message ?? ""; $("#status").classList.toggle("error", error); }
function hidePanels() { panels.forEach((selector) => { $(selector).hidden = true; }); }
function render(next) {
  state = next; $("#connect-panel").hidden = Boolean(state?.connected); $("#study-panel").hidden = !state?.connected; if (!state?.connected) return;
  $("#study-title").textContent = state.title; $("#progress").textContent = `Completed tasks: ${state.completedTasks} of ${state.tasks.length}`; $("#consent-text").textContent = state.consentText; hidePanels();
  if (state.phase === "consent") $("#consent-panel").hidden = false;
  if (state.phase === "calibrating") $("#calibration-panel").hidden = false;
  if (state.phase === "ready" && state.nextTask) { $("#task-title").textContent = `Task ${state.nextTask.position}: ${state.nextTask.title}`; $("#task-prompt").textContent = state.nextTask.prompt; $("#task-panel").hidden = false; }
  if (state.phase === "running") $("#running-panel").hidden = false;
  if (state.phase === "ready" && !state.nextTask) $("#submit-panel").hidden = false;
  if (state.phase === "submitted") $("#complete-panel").hidden = false;
  showStatus(state.error, Boolean(state.error));
}
async function invoke(type, payload = {}) { showStatus("Working…"); const result = await chrome.runtime.sendMessage({ type, ...payload }); if (!result?.ok) { render(result?.state ?? state); throw new Error(result?.error ?? "Extension operation failed"); } render(result.state); return result; }
$("#consent-check").onchange = (event) => { $("#accept-consent").disabled = !event.target.checked; };
$("#connect").onclick = async () => { try { await invoke("CONNECT_STUDY", { participantLink: $("#participant-link").value, apiBase: $("#api-base").value, captureSnapshots: $("#snapshots").checked }); } catch (error) { showStatus(error.message, true); } };
$("#accept-consent").onclick = async () => { try { await invoke("ACCEPT_CONSENT"); } catch (error) { showStatus(error.message, true); } };
$("#refresh").onclick = async () => { try { await invoke("STUDY_STATUS"); } catch (error) { showStatus(error.message, true); } };
$("#start-task").onclick = async () => { try { await invoke("START_STUDY_TASK"); window.close(); } catch (error) { showStatus(error.message, true); } };
$("#complete-task").onclick = async () => { try { await invoke("COMPLETE_STUDY_TASK"); } catch (error) { showStatus(error.message, true); } };
$("#submit-study").onclick = async () => { try { await invoke("SUBMIT_STUDY"); } catch (error) { showStatus(error.message, true); } };
$("#download").onclick = async () => { try { const { artifact } = await invoke("DOWNLOAD_ARTIFACT"); const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" })); await chrome.downloads.download({ url, filename: "webgaze-extension-artifact.json", saveAs: true }); } catch (error) { showStatus(error.message, true); } };
void invoke("STUDY_STATUS").catch((error) => showStatus(error.message, true));
