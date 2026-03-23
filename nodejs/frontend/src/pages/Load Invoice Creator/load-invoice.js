function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlWithBreaks(str) {
  return escapeHtml(str).replaceAll("\n", "<br />");
}

function normalizeMoney(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: false, value: "", formatted: "" };

  const numeric = raw.replaceAll(",", "").replaceAll("$", "");
  const n = Number(numeric);
  if (!Number.isFinite(n)) return { ok: false, value: raw, formatted: raw };

  return {
    ok: true,
    value: n,
    formatted: n.toLocaleString(undefined, { style: "currency", currency: "USD" }),
  };
}

function formatDate(yyyyMmDd) {
  // input from <input type="date"> is YYYY-MM-DD
  const s = String(yyyyMmDd ?? "").trim();
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateInputValue(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function collectFormData(form) {
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());
  return {
    invoiceNumber: String(data.invoiceNumber ?? "").trim(),
    invoiceDate: String(data.invoiceDate ?? "").trim(),
    dueDate: String(data.dueDate ?? "").trim(),
    rate: String(data.rate ?? "").trim(),
    pickupDate: String(data.pickupDate ?? "").trim(),
    deliveryDate: String(data.deliveryDate ?? "").trim(),
    pickupAddress: String(data.pickupAddress ?? "").trim(),
    deliveryAddress: String(data.deliveryAddress ?? "").trim(),
    brokerName: String(data.brokerName ?? "").trim(),
    brokerAddress: String(data.brokerAddress ?? "").trim(),
    driverName: String(data.driverName ?? "").trim(),
    carrierName: String(data.carrierName ?? "").trim(),
    carrierAddress: String(data.carrierAddress ?? "").trim(),
    paymentOption: String(data.paymentOption ?? "Check").trim(),
    zellePhone: String(data.zellePhone ?? "").trim(),
    achRouting: String(data.achRouting ?? "").trim(),
    achAccount: String(data.achAccount ?? "").trim(),
  };
}

function validate(data) {
  const missing = [];
  const requiredBase = [
    "invoiceNumber",
    "invoiceDate",
    "dueDate",
    "rate",
    "pickupDate",
    "deliveryDate",
    "pickupAddress",
    "deliveryAddress",
    "brokerName",
    "brokerAddress",
    "driverName",
    "carrierName",
    "carrierAddress",
    "paymentOption",
  ];

  for (const k of requiredBase) {
    if (!String(data[k] ?? "").trim()) missing.push(k);
  }

  if (data.paymentOption === "Zelle") {
    if (!String(data.zellePhone ?? "").trim()) missing.push("zellePhone");
  }
  if (data.paymentOption === "ACH") {
    if (!String(data.achRouting ?? "").trim()) missing.push("achRouting");
    if (!String(data.achAccount ?? "").trim()) missing.push("achAccount");
  }
  return { ok: missing.length === 0, missing };
}

function renderInvoice(data) {
  const rate = normalizeMoney(data.rate);
  const pickupDate = formatDate(data.pickupDate);
  const deliveryDate = formatDate(data.deliveryDate);

  const invoiceNumber = escapeHtml(data.invoiceNumber);
  const invoiceDate = formatDate(data.invoiceDate);
  const dueDate = formatDate(data.dueDate);
  const brokerName = escapeHtml(data.brokerName);
  const brokerAddress = escapeHtmlWithBreaks(data.brokerAddress);
  const driverName = escapeHtml(data.driverName);
  const carrierName = escapeHtml(data.carrierName);
  const carrierAddress = escapeHtmlWithBreaks(data.carrierAddress);
  const pickupAddress = escapeHtmlWithBreaks(data.pickupAddress);
  const deliveryAddress = escapeHtmlWithBreaks(data.deliveryAddress);
  const rateDisplay = escapeHtml(rate.formatted || data.rate);
  const paymentOption = escapeHtml(data.paymentOption || "Check");
  const zellePhone = escapeHtml(data.zellePhone || "");
  const achRouting = escapeHtml(data.achRouting || "");
  const achAccount = escapeHtml(data.achAccount || "");

  let paymentDetailsHtml = `<div class="inv-party-sub"><strong>Payment Option:</strong> ${paymentOption}</div>`;
  if (data.paymentOption === "Zelle") {
    paymentDetailsHtml += `<div class="inv-party-sub"><strong>Zelle Phone:</strong> ${zellePhone}</div>`;
  } else if (data.paymentOption === "ACH") {
    paymentDetailsHtml += `<div class="inv-party-sub"><strong>Routing #:</strong> ${achRouting}</div>`;
    paymentDetailsHtml += `<div class="inv-party-sub"><strong>Account #:</strong> ${achAccount}</div>`;
  }

  return `
    <div class="invoice invoice-v2" role="document" aria-label="Printable invoice">
      <div class="inv-header">
        <div class="inv-left">
          <div class="inv-title">Invoice</div>
          <div class="inv-thanks">We thank you for your continued business.</div>
        </div>
        <div class="inv-right">
          <div class="inv-meta-row">
            <div class="inv-meta-label">Invoice #</div>
            <div class="inv-meta-val"><strong>${invoiceNumber}</strong></div>
          </div>
          <div class="inv-meta-row">
            <div class="inv-meta-label">Date</div>
            <div class="inv-meta-val">${escapeHtml(invoiceDate)}</div>
          </div>
          <div class="inv-meta-row">
            <div class="inv-meta-label">Due Date</div>
            <div class="inv-meta-val">${escapeHtml(dueDate)}</div>
          </div>
        </div>
      </div>

      <div class="inv-balance">
        <div class="inv-balance-label">Balance Due</div>
        <div class="inv-balance-amt">${rateDisplay}</div>
      </div>

      <div class="inv-parties">
        <div class="inv-party">
          <div class="inv-party-title">Bill To:</div>
          <div class="inv-party-body">
            <div class="inv-party-name">${brokerName}</div>
            <div class="inv-party-sub inv-party-address">${brokerAddress}</div>
          </div>
        </div>

        <div class="inv-party">
          <div class="inv-party-title">Payable To:</div>
          <div class="inv-party-body">
            <div class="inv-party-name">${carrierName}</div>
            <div class="inv-party-sub inv-party-address">${carrierAddress}</div>
            <div class="inv-party-pay">${paymentDetailsHtml}</div>
          </div>
        </div>
      </div>

      <table class="inv-table" aria-label="Load table">
        <thead>
          <tr>
            <th>Pickup Date</th>
            <th>Delivery Date</th>
            <th>Origin</th>
            <th>Destination</th>
            <th>Driver</th>
            <th class="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(pickupDate)}</td>
            <td>${escapeHtml(deliveryDate)}</td>
            <td class="addr">${pickupAddress}</td>
            <td class="addr">${deliveryAddress}</td>
            <td>${driverName}</td>
            <td class="right">${rateDisplay}</td>
          </tr>
        </tbody>
      </table>

      <div class="inv-totals">
        <div class="inv-totals-row">
          <div class="inv-totals-label">Subtotal:</div>
          <div class="inv-totals-val">${rateDisplay}</div>
        </div>
        <div class="inv-totals-row">
          <div class="inv-totals-label">Postage:</div>
          <div class="inv-totals-val">$0.00</div>
        </div>
        <div class="inv-totals-rule"></div>
        <div class="inv-totals-row total">
          <div class="inv-totals-label">Total:</div>
          <div class="inv-totals-val">${rateDisplay}</div>
        </div>
      </div>

      ${
        rate.ok
          ? ""
          : `<div class="inv-note">
               Note: rate was not recognized as a number; printed exactly as entered.
             </div>`
      }

      <div class="inv-footer">
      </div>
    </div>
  `;
}

function showError(message) {
  alert(message);
}

function main() {
  const form = $("invoice-form");
  const invoiceRoot = $("invoice-root");
  const generateBtn = $("generateBtn");
  const printBtn = $("printBtn");
  const clearBtn = $("clearBtn");
  const invoiceDateInput = $("invoiceDate");
  const dueDateInput = $("dueDate");
  const paymentOptionSelect = $("paymentOption");
  const zelleFields = $("zelleFields");
  const achFields = $("achFields");
  const zellePhone = $("zellePhone");
  const achRouting = $("achRouting");
  const achAccount = $("achAccount");

  // Defaults for convenience (today + 30 days)
  const now = new Date();
  if (!invoiceDateInput.value) invoiceDateInput.value = toDateInputValue(now);
  if (!dueDateInput.value) dueDateInput.value = toDateInputValue(addDays(now, 30));

  function setVisible(el, visible) {
    el.classList.toggle("hidden", !visible);
    el.setAttribute("aria-hidden", String(!visible));
  }

  function updatePaymentVisibility() {
    const opt = String(paymentOptionSelect.value || "Check");
    const isZelle = opt === "Zelle";
    const isAch = opt === "ACH";
    setVisible(zelleFields, isZelle);
    setVisible(achFields, isAch);

    if (!isZelle) zellePhone.value = "";
    if (!isAch) {
      achRouting.value = "";
      achAccount.value = "";
    }
  }

  paymentOptionSelect.addEventListener("change", updatePaymentVisibility);
  updatePaymentVisibility();

  // Avoid accidental submit refresh
  form.addEventListener("submit", (e) => e.preventDefault());

  generateBtn.addEventListener("click", () => {
    const data = collectFormData(form);
    const v = validate(data);
    if (!v.ok) {
      showError("Please fill out all required fields before generating the invoice.");
      return;
    }

    invoiceRoot.innerHTML = renderInvoice(data);
    printBtn.disabled = false;
  });

  printBtn.addEventListener("click", () => {
    window.print();
  });

  clearBtn.addEventListener("click", () => {
    if (!confirm("Clear the form and invoice preview?")) return;
    form.reset();
    const now2 = new Date();
    invoiceDateInput.value = toDateInputValue(now2);
    dueDateInput.value = toDateInputValue(addDays(now2, 30));
    updatePaymentVisibility();
    invoiceRoot.innerHTML = `
      <div class="empty">
        <div class="empty-title">No invoice yet</div>
        <div class="subtle">Complete the form and click <strong>Generate invoice</strong>.</div>
      </div>
    `;
    printBtn.disabled = true;
  });
}

main();


