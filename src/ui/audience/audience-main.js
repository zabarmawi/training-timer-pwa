import { emptyAudienceState } from "../../core/audience/audience-state.js";
import { createAudienceReceiver } from "../../core/audience/audience-sync.js";
import { createWakeLockManager } from "../../core/platform/wake-lock.js";
import { mountAudienceDisplay } from "./audience-view.js";

const wakeLock = createWakeLockManager();
const display = mountAudienceDisplay(document.querySelector("#audience-app"), emptyAudienceState(Date.now()), { wakeLock });
createAudienceReceiver({ onState: display.setState });
