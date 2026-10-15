(function () {
  var root = document.getElementById("wgw-docs-auth");
  var tokenUrl = root.getAttribute("data-token-url");
  var specUrl = root.getAttribute("data-spec-url");
  var statusEl = document.getElementById("wgw-docs-auth-status");
  var submitBtn = document.getElementById("wgw-docs-auth-submit");

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = "wgw-docs-auth-status" + (kind ? " wgw-docs-auth-status--" + kind : "");
  }

  window.ui = SwaggerUIBundle({
    url: specUrl,
    dom_id: "#swagger-ui",
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
    layout: "BaseLayout",
    persistAuthorization: false
  });

  document.getElementById("wgw-docs-auth-form").addEventListener("submit", function (event) {
    event.preventDefault();
    setStatus("", "");
    var username = document.getElementById("wgw-docs-username").value.trim();
    var password = document.getElementById("wgw-docs-password").value;
    if (!username || !password) {
      setStatus("Enter username and password.", "error");
      return;
    }
    submitBtn.disabled = true;
    fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: username, password: password })
    })
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok) {
            setStatus(data.error || data.message || ("Login failed (" + response.status + ")."), "error");
            return;
          }
          if (!data.access_token) {
            setStatus("Token response missing access_token.", "error");
            return;
          }
          window.ui.preauthorizeApiKey("bearerAuth", data.access_token);
          setStatus("Authorized" + (data.username ? " as " + data.username : "") + ".", "success");
        });
      })
      .catch(function () {
        setStatus("Network error: could not reach token endpoint.", "error");
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  });
})();
