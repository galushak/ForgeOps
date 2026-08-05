(function () {
  const loginForm = document.querySelector("[data-login-form]");
  if (loginForm) {
    const username = loginForm.querySelector("[name='username']");
    const remember = loginForm.querySelector("[data-remember-username]");
    const saved = window.localStorage.getItem("forgeops.username");
    if (saved) {
      username.value = saved;
      remember.checked = true;
      loginForm.querySelector("[name='password']").focus();
    }
    loginForm.addEventListener("submit", function () {
      if (remember.checked) window.localStorage.setItem("forgeops.username", username.value);
      else window.localStorage.removeItem("forgeops.username");
    });
  }

  const appConfirmDialog = document.querySelector("[data-app-confirm]");
  const showAppConfirm = function (options) {
    return new Promise(function (resolve) {
      if (!appConfirmDialog) {
        resolve(false);
        return;
      }

      const title = appConfirmDialog.querySelector("[data-app-confirm-title]");
      const message = appConfirmDialog.querySelector("[data-app-confirm-message]");
      const cancelButton = appConfirmDialog.querySelector("[data-app-confirm-cancel]");
      const acceptButton = appConfirmDialog.querySelector("[data-app-confirm-accept]");
      const destructive = options.tone === "danger";
      let finished = false;

      title.textContent = options.title || (destructive ? "Confirm permanent action" : "Confirm action");
      message.textContent = options.message;
      acceptButton.textContent = options.confirmLabel || "Continue";
      acceptButton.classList.toggle("btn-danger", destructive);
      acceptButton.classList.toggle("btn-primary", !destructive);

      const finish = function (approved) {
        if (finished) return;
        finished = true;
        appConfirmDialog.close();
        resolve(approved);
      };
      cancelButton.onclick = function () { finish(false); };
      acceptButton.onclick = function () { finish(true); };
      appConfirmDialog.oncancel = function (event) {
        event.preventDefault();
        finish(false);
      };
      appConfirmDialog.onclick = function (event) {
        if (event.target === appConfirmDialog) finish(false);
      };
      appConfirmDialog.showModal();
      cancelButton.focus();
    });
  };

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!form.matches("form[data-confirm]") || form.dataset.confirmApproved === "true") return;
    event.preventDefault();
    const submitter = event.submitter;
    const destructive = submitter && submitter.classList.contains("btn-danger");
    showAppConfirm({
      message: form.dataset.confirm,
      confirmLabel: submitter ? submitter.textContent.trim() : "Continue",
      tone: destructive ? "danger" : "primary"
    }).then(function (approved) {
      if (!approved) return;
      form.dataset.confirmApproved = "true";
      if (submitter) form.requestSubmit(submitter);
      else form.requestSubmit();
    });
  }, true);

  const reportFilters = document.querySelector("[data-report-filters]");
  if (reportFilters) {
    const reportType = reportFilters.querySelector("[name='range']");
    const syncReportFields = function () {
      reportFilters.querySelectorAll("[data-report-field]").forEach(function (field) {
        field.hidden = field.dataset.reportField !== reportType.value;
      });
    };
    reportType.addEventListener("change", syncReportFields);
    syncReportFields();
  }

  const projectForm = document.querySelector("[data-project-form]");
  if (projectForm) {
    const clientSelect = projectForm.querySelector("[name='client']");
    const addressSelect = projectForm.querySelector("[name='service_address_choice']");
    const newAddressPanel = projectForm.querySelector("[data-new-address-panel]");

    const syncProjectAddresses = function () {
      const clientId = clientSelect ? clientSelect.value : "";
      if (clientSelect && addressSelect) {
        Array.from(addressSelect.options).forEach(function (option) {
          const ownerId = option.dataset.clientId;
          option.hidden = Boolean(ownerId && clientId && ownerId !== clientId);
        });
        if (addressSelect.selectedOptions[0] && addressSelect.selectedOptions[0].hidden) addressSelect.value = "";
      }
      if (newAddressPanel && addressSelect) newAddressPanel.hidden = addressSelect.value !== "__new__";
    };

    if (clientSelect) clientSelect.addEventListener("change", syncProjectAddresses);
    if (addressSelect) addressSelect.addEventListener("change", syncProjectAddresses);
    syncProjectAddresses();
  }

  const invoiceEditor = document.querySelector("[data-invoice-editor]");
  if (invoiceEditor) {
    const paymentTerms = document.querySelector("[name='payment_terms']");
    const customDueDate = invoiceEditor.querySelector("[data-custom-due-date]");
    const syncDueDate = function () {
      if (customDueDate && paymentTerms) customDueDate.hidden = paymentTerms.value !== "custom";
    };
    if (paymentTerms) paymentTerms.addEventListener("change", syncDueDate);
    syncDueDate();
  }

  document.querySelectorAll(".selection-menu").forEach(function (menu) {
    const summaryStatus = menu.querySelector("summary span");
    const checkboxes = menu.querySelectorAll("input[type='checkbox']");
    const syncCount = function () {
      if (!summaryStatus) return;
      const count = Array.from(checkboxes).filter(function (checkbox) { return checkbox.checked; }).length;
      summaryStatus.textContent = count + " selected";
    };
    checkboxes.forEach(function (checkbox) { checkbox.addEventListener("change", syncCount); });
    syncCount();
  });

  const installDocumentDirtyGuard = function (formId) {
    const form = document.getElementById(formId);
    if (!form) return;

    const controls = Array.from(document.querySelectorAll("[form='" + formId + "']"));
    const controlValue = function (control) {
      if (control.type === "checkbox" || control.type === "radio") {
        return control.name + ":" + control.value + ":" + control.checked;
      }
      return control.name + ":" + control.value;
    };
    const snapshot = function () { return controls.map(controlValue).join("|"); };
    const originalSnapshot = snapshot();
    let isDirty = false;
    let navigationApproved = false;

    const syncDirtyState = function () {
      isDirty = snapshot() !== originalSnapshot;
    };
    controls.forEach(function (control) {
      control.addEventListener("input", syncDirtyState);
      control.addEventListener("change", syncDirtyState);
    });

    form.addEventListener("submit", function () {
      navigationApproved = true;
    });

    document.addEventListener("click", function (event) {
      const link = event.target.closest("a[href]");
      if (!link || !isDirty || navigationApproved) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showAppConfirm({
        title: "Unsaved document changes",
        message: "Leave this page without saving your quote or invoice changes?",
        confirmLabel: "Leave without saving"
      }).then(function (approved) {
        if (!approved) return;
        navigationApproved = true;
        window.location.assign(link.href);
      });
    }, true);

    document.addEventListener("submit", function (event) {
      if (event.defaultPrevented || event.target === form || !isDirty || navigationApproved) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const submittedForm = event.target;
      const submitter = event.submitter;
      showAppConfirm({
        title: "Unsaved document changes",
        message: "Continue with this action without saving your quote or invoice changes?",
        confirmLabel: "Continue without saving"
      }).then(function (approved) {
        if (!approved) {
          delete submittedForm.dataset.confirmApproved;
          return;
        }
        navigationApproved = true;
        if (submitter) submittedForm.requestSubmit(submitter);
        else submittedForm.requestSubmit();
      });
    });

    window.addEventListener("beforeunload", function (event) {
      if (!isDirty || navigationApproved) return;
      event.preventDefault();
      event.returnValue = "";
    });
  };

  installDocumentDirtyGuard("quote-details-form");
  installDocumentDirtyGuard("invoice-details-form");

  const ledgerExpenseForm = document.querySelector("[data-ledger-expense-form]");
  if (ledgerExpenseForm) {
    const vendorSelect = ledgerExpenseForm.querySelector("[name='vendor_choice']");
    const newVendorPanel = ledgerExpenseForm.querySelector("[data-new-vendor-panel]");
    const syncVendor = function () {
      if (newVendorPanel && vendorSelect) newVendorPanel.hidden = vendorSelect.value !== "__new__";
    };
    if (vendorSelect) vendorSelect.addEventListener("change", syncVendor);
    syncVendor();

    const dataNode = document.getElementById("ledger-dependent-data");
    if (dataNode && ledgerExpenseForm.dataset.expenseType === "project") {
      const data = JSON.parse(dataNode.textContent);
      const clientSelect = ledgerExpenseForm.querySelector("[name='client']");
      const projectSelect = ledgerExpenseForm.querySelector("[name='project']");
      const quoteSelect = ledgerExpenseForm.querySelector("[name='quote']");
      const invoiceSelect = ledgerExpenseForm.querySelector("[name='invoice']");

      const replaceOptions = function (select, rows, placeholder, selectedValue) {
        if (!select) return;
        select.replaceChildren(new Option(placeholder, ""));
        rows.forEach(function (row) { select.add(new Option(row.label, String(row.id))); });
        if (selectedValue && Array.from(select.options).some(function (option) { return option.value === selectedValue; })) {
          select.value = selectedValue;
        }
      };
      const syncDocuments = function (preserveSelection) {
        const projectId = projectSelect ? projectSelect.value : "";
        const quoteValue = preserveSelection && quoteSelect ? quoteSelect.value : "";
        const invoiceValue = preserveSelection && invoiceSelect ? invoiceSelect.value : "";
        replaceOptions(quoteSelect, data.quotes.filter(function (row) { return String(row.projectId) === projectId; }), "No quote selected", quoteValue);
        replaceOptions(invoiceSelect, data.invoices.filter(function (row) { return String(row.projectId) === projectId; }), "No invoice selected", invoiceValue);
      };
      const syncProjects = function (preserveSelection) {
        const clientId = clientSelect ? clientSelect.value : "";
        const projectValue = preserveSelection && projectSelect ? projectSelect.value : "";
        replaceOptions(projectSelect, data.projects.filter(function (row) { return String(row.clientId) === clientId; }), "Select an active project", projectValue);
        syncDocuments(preserveSelection);
      };

      if (clientSelect) clientSelect.addEventListener("change", function () { syncProjects(false); });
      if (projectSelect) projectSelect.addEventListener("change", function () { syncDocuments(false); });
      syncProjects(true);
    }
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/static/service-worker.js").catch(function () {});
    });
  }
})();
