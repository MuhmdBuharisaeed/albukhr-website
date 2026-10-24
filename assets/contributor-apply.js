/* ALBUKHR Contributor Form One — Mainnet only. No Supabase client or browser storage. */
(function (window, document) {
  "use strict";
  const API_BASE = "https://albukhr-api.onrender.com";
  const PRIVACY_VERSION = "contributor_application_privacy_v1";
  const MIN_TEXT = 50;
  const $ = (id) => document.getElementById(id);
  let piAccessToken = null;
  let piUsername = null;
  let piInitPromise = null;
  let submitInFlight = false;

  function status(message, isError) {
    const node = $("applicationStatus");
    if (!node) return;
    node.textContent = message || "";
    node.classList.toggle("error", Boolean(isError));
  }
  function setIdentity(connected, username) {
    $("identityState").textContent = connected ? `Pi identity connected${username ? ` · @${username}` : ""}` : "Pi identity not connected";
    $("identityHelp").textContent = connected
      ? "The server will independently verify the Pi access token before accepting your application."
      : "Open this page inside Pi Browser, then connect your Mainnet Pi account before submitting.";
    $("connectPiButton").textContent = connected ? "Reconnect Pi" : "Connect Pi";
    $("checkStatusButton").disabled = !connected;
  }
  async function connectPi(forceReconnect = false) {
    if (piAccessToken && !forceReconnect) return true;
    if (!window.Pi || typeof window.Pi.init !== "function" || typeof window.Pi.authenticate !== "function") {
      throw new Error("Pi SDK is unavailable. Open this page inside Pi Browser and try again.");
    }
    if (!piInitPromise) {
      // This corporate website's application is deliberately Mainnet-only; it has no Testnet selector.
      piInitPromise = window.Pi.init({ version: "2.0", sandbox: false }).catch((error) => {
        piInitPromise = null;
        throw error;
      });
    }
    await piInitPromise;
    const auth = await window.Pi.authenticate(["username"], () => {
      console.warn("Pi reported an incomplete payment during Contributor application sign-in.");
    });
    const token = String(auth?.accessToken || "").trim();
    if (!token) throw new Error("Pi did not return an access token. Please try again.");
    // Reuse the existing trusted identity gateway so a verified Mainnet public.users row exists.
    const identityResponse = await fetch(`${API_BASE}/api/identity/login`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      credentials: "omit", cache: "no-store", redirect: "error"
    });
    const identity = await identityResponse.json().catch(() => null);
    if (!identityResponse.ok || identity?.success !== true || String(identity?.network || "").toLowerCase() !== "mainnet" || !identity?.pi_uid) {
      throw new Error(identity?.error || "ALBUKHR could not verify and register your Mainnet identity.");
    }
    const username = String(identity?.username || auth?.user?.username || "").trim();
    // Keep the bearer token in memory only. Never write it to localStorage/sessionStorage or URLs.
    piAccessToken = token;
    piUsername = username || null;
    setIdentity(true, piUsername);
    return true;
  }
  async function api(path, options) {
    if (!piAccessToken) throw new Error("Connect your Mainnet Pi identity before continuing.");
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${piAccessToken}`,
        ...(options?.body ? { "Content-Type": "application/json" } : {}),
        ...(options?.headers || {})
      },
      credentials: "omit",
      cache: "no-store",
      redirect: "error"
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success !== true || String(data?.network || "").toLowerCase() !== "mainnet") {
      throw new Error(data?.error || `ALBUKHR API request failed (${response.status}).`);
    }
    return data;
  }
  function selectedAreas() {
    return Array.from(document.querySelectorAll('input[name="areas"]:checked')).map((el) => el.value);
  }
  function validateForm() {
    const fullName = $("fullName").value.trim();
    const email = $("contactEmail").value.trim().toLowerCase();
    const country = $("country").value.trim();
    const occupation = $("occupation").value.trim();
    const primaryExpertise = $("primaryExpertise").value.trim();
    const experience = $("experienceSummary").value.trim();
    const statement = $("contributionStatement").value.trim();
    const areas = selectedAreas();
    if (fullName.length < 2 || fullName.length > 120) throw new Error("Enter a valid full name (2–120 characters).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid contact email address.");
    if (!country || country.length > 100) throw new Error("Enter your country.");
    if (!occupation || occupation.length > 120) throw new Error("Enter your current occupation or role.");
    if (!primaryExpertise || primaryExpertise.length > 120) throw new Error("Enter your primary expertise.");
    if (areas.length < 1 || areas.length > 5) throw new Error("Choose between 1 and 5 contribution areas.");
    if (experience.length < MIN_TEXT || experience.length > 2000) throw new Error("Relevant experience must be 50–2,000 characters.");
    if (statement.length < MIN_TEXT || statement.length > 2000) throw new Error("Your contribution statement must be 50–2,000 characters.");
    if (!$ ("privacyConsent").checked) throw new Error("Read and accept the application privacy notice before submitting.");
    return {
      full_name: fullName,
      contact_email: email,
      country,
      occupation,
      primary_expertise: primaryExpertise,
      contribution_areas: areas,
      experience_summary: experience,
      contribution_statement: statement,
      privacy_version: PRIVACY_VERSION,
      privacy_consent: true
    };
  }
  function renderApplication(app) {
    if (!app) {
      $("applicationResult").classList.add("hidden");
      status("No Contributor application was found for this authenticated Pi identity.");
      return;
    }
    const statusValue = String(app.status || "submitted").toLowerCase();
    $("resultTitle").textContent = statusValue === "onboarded" ? "Contributor onboarding completed" : "Application status";
    $("resultMessage").textContent = app.applicant_status_message || "Your application status is recorded by ALBUKHR. The review team will update it when there is a decision or request for information.";
    $("resultReference").textContent = app.application_ref || "Not available";
    $("resultState").textContent = statusValue.replaceAll("_", " ").toUpperCase();
    $("applicationResult").classList.remove("hidden");
  }
  async function handleSubmit(event) {
    event.preventDefault();
    if (submitInFlight) return;
    const button = $("submitApplicationButton");
    try {
      submitInFlight = true;
      button.disabled = true;
      status("Validating your application…");
      const payload = validateForm();
      await connectPi();
      status("Submitting securely to the ALBUKHR Mainnet API…");
      const result = await api("/api/contributor/applications", { method: "POST", body: JSON.stringify(payload) });
      const app = result.data?.application || result.application || null;
      if (!app?.application_ref) throw new Error("The server did not confirm an application reference. Please check status before retrying.");
      renderApplication(app);
      status("Application submitted successfully.");
      $("checkStatusButton").disabled = false;
    } catch (error) {
      console.error("[ALBUKHR CONTRIBUTOR APPLICATION]", error);
      status(error?.message || "Application could not be submitted.", true);
    } finally {
      submitInFlight = false;
      button.disabled = false;
    }
  }
  async function checkStatus() {
    try {
      await connectPi();
      status("Checking application status…");
      const result = await api("/api/contributor/application/status", { method: "GET" });
      renderApplication(result.data?.application || null);
    } catch (error) {
      console.error("[ALBUKHR CONTRIBUTOR APPLICATION STATUS]", error);
      status(error?.message || "Application status could not be loaded.", true);
    }
  }
  $("connectPiButton").addEventListener("click", async () => {
    try { status("Connecting to Pi Mainnet…"); await connectPi(true); status("Pi identity connected. Complete the form and submit when ready."); }
    catch (error) { status(error?.message || "Pi identity could not be connected.", true); }
  });
  $("applicationForm").addEventListener("submit", handleSubmit);
  $("checkStatusButton").addEventListener("click", checkStatus);
  document.querySelectorAll('input[name="areas"]').forEach((el) => el.addEventListener("change", () => {
    const selected = selectedAreas();
    if (selected.length > 5) { el.checked = false; status("Choose no more than five contribution areas.", true); }
    else if (selected.length) status("");
  }));
  setIdentity(false, null);
})(window, document);
