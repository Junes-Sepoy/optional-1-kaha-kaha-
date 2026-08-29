/* ============================================================================
   Kaha Shop — checkout
   ----------------------------------------------------------------------------
   HOW THIS WORKS:

   1. Customer fills in their delivery details.
   2. Those details are emailed to hello@kahamind.com via Web3Forms (no PHP,
      so this works on any host and while testing locally).
   3. They're handed to the Razorpay payment button, which covers UPI
      (GPay / PhonePe / Paytm / any app), cards, net banking, wallets and EMI.

   Orders are recorded in two places: your Google Sheet (via orders-sheet.gs)
   and an email to hello@kahamind.com. Either can fail without losing the
   order, because both are attempted.

   IMPORTANT: the amount charged is set in your Razorpay dashboard against
   payment button pl_TVC7oYZyelKsEx — NOT in this file. The price below is
   only what the page displays. Keep the two in step or the page will show a
   customer one figure and charge them another.
   ========================================================================== */

const SHOP_CONFIG = {
    // Google Sheet order database. Paste the Web app URL you get from
    // deploying orders-sheet.gs — see the comments at the top of that file.
    // Leave blank and the page simply skips the sheet; the email still sends.
    SHEET_ENDPOINT: '',

    // Only needed if you set SHARED_TOKEN in orders-sheet.gs. Must match it.
    SHEET_TOKEN: '',

    // Same Web3Forms key as your contact page — worth making a separate one
    // so orders don't land in with therapy enquiries.
    WEB3FORMS_KEY: '37b5f01a-e781-4f14-9931-036def961192',

    PRODUCT_NAME: 'Metal Health Cap',
    UNIT_PRICE: 1499    // display only — must match the Razorpay button
};

document.addEventListener('DOMContentLoaded', function () {

    const steps = {
        product:  document.getElementById('stepProduct'),
        delivery: document.getElementById('stepDelivery'),
        payment:  document.getElementById('stepPayment'),
        done:     document.getElementById('stepDone')
    };

    const deliveryForm  = document.getElementById('deliveryForm');
    const deliveryError = document.getElementById('deliveryError');
    const paymentError  = document.getElementById('paymentError');
    const submitBtn     = deliveryForm.querySelector('button[type="submit"]');

    const order = { customer: {} };

    /* ---------- helpers ---------- */
    const rupees = n => '\u20B9' + n.toLocaleString('en-IN');

    function showStep(name) {
        Object.keys(steps).forEach(k => { steps[k].hidden = (k !== name); });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function setError(box, message) {
        if (!box) return;
        if (!message) { box.hidden = true; box.textContent = ''; return; }
        box.textContent = message;
        box.hidden = false;
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /* ---------- prices shown on the page ---------- */
    function fillSummaries() {
        const total = SHOP_CONFIG.UNIT_PRICE;

        ['', '2'].forEach(suffix => {
            const item = document.getElementById('summaryItem' + suffix);
            const sub  = document.getElementById('summarySubtotal' + suffix);
            const tot  = document.getElementById('summaryTotal' + suffix);
            if (item) item.textContent = SHOP_CONFIG.PRODUCT_NAME + ' \u00D7 1';
            if (sub)  sub.textContent = rupees(total);
            if (tot)  tot.textContent = rupees(total);
        });
    }

    /* ---------- step 1: product ---------- */
    document.getElementById('goToDelivery').addEventListener('click', function () {
        showStep('delivery');
    });

    document.getElementById('backToProduct').addEventListener('click', function () {
        showStep('product');
    });

    /* ---------- step 2: delivery details ---------- */
    deliveryForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        setError(deliveryError, '');

        const data = {
            name:     document.getElementById('custName').value.trim(),
            email:    document.getElementById('custEmail').value.trim(),
            phone:    document.getElementById('custPhone').value.trim().replace(/\D/g, ''),
            address1: document.getElementById('addr1').value.trim(),
            address2: document.getElementById('addr2').value.trim(),
            city:     document.getElementById('city').value.trim(),
            state:    document.getElementById('state').value,
            pincode:  document.getElementById('pincode').value.trim(),
            notes:    document.getElementById('deliveryNotes').value.trim()
        };

        if (!data.name)     return setError(deliveryError, 'Add your full name so we know who to address the parcel to.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email))
                            return setError(deliveryError, 'That email address doesn\u2019t look right. Check it and try again.');
        if (!/^[6-9]\d{9}$/.test(data.phone))
                            return setError(deliveryError, 'Enter a 10-digit Indian mobile number \u2014 the courier will call it.');
        if (!data.address1) return setError(deliveryError, 'Add the first line of your address.');
        if (!data.city)     return setError(deliveryError, 'Add your city.');
        if (!data.state)    return setError(deliveryError, 'Pick your state.');
        if (!/^\d{6}$/.test(data.pincode))
                            return setError(deliveryError, 'PIN codes are 6 digits. Check yours and try again.');

        order.customer = data;

        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving your details\u2026';

        const result = await recordOrder(data);

        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue to payment';

        document.getElementById('summaryAddress').innerHTML = [
            data.name,
            data.address1,
            data.address2,
            data.city + ', ' + data.state + ' ' + data.pincode,
            data.phone
        ].filter(Boolean).join('<br>');

        document.getElementById('doneName').textContent  = data.name.split(' ')[0];
        document.getElementById('doneEmail').textContent = data.email;

        if (result.orderId) {
            const ref = document.getElementById('doneOrderId');
            if (ref) ref.textContent = result.orderId;
            const refLine = document.getElementById('doneOrderLine');
            if (refLine) refLine.hidden = false;
        }

        fillSummaries();
        showStep('payment');

        // Only warn if BOTH records failed — one surviving copy is enough
        if (!result.sheet && !result.email) {
            setError(paymentError,
                'We couldn\u2019t save your delivery address automatically. You can still pay below \u2014 ' +
                'just email your address to hello@kahamind.com afterwards so we know where to send the cap.');
        }
    });

    /* ---------- recording an order ---------- */
    // Written to the Google Sheet and emailed, independently. Both are tried
    // so a failure in one doesn't lose the order.
    async function recordOrder(d) {
        const [sheet, email] = await Promise.all([
            sendToSheet(d).catch(() => ({ ok: false, orderId: null })),
            sendOrderEmail(d).catch(() => false)
        ]);
        return { sheet: sheet.ok, email: email, orderId: sheet.orderId };
    }

    async function sendToSheet(d) {
        if (!SHOP_CONFIG.SHEET_ENDPOINT) return { ok: false, orderId: null };

        const payload = {
            token: SHOP_CONFIG.SHEET_TOKEN,
            name: d.name,
            email: d.email,
            phone: d.phone,
            address1: d.address1,
            address2: d.address2,
            city: d.city,
            state: d.state,
            pincode: d.pincode,
            notes: d.notes,
            product: SHOP_CONFIG.PRODUCT_NAME + ' \u00D7 1',
            amount: String(SHOP_CONFIG.UNIT_PRICE),
            payment_status: 'Awaiting payment'
        };

        // text/plain keeps this a "simple" request, so the browser skips the
        // CORS preflight that Apps Script can't answer.
        try {
            const res = await fetch(SHOP_CONFIG.SHEET_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const out = await res.json();
            return { ok: !!out.ok, orderId: out.order_id || null };
        } catch (err) {
            // Some Apps Script deployments block reading the response even
            // though the write succeeds. Resend fire-and-forget so the row
            // still lands, and report it as unconfirmed.
            console.warn('[Kaha Shop] Could not read the sheet response, retrying blind:', err);
            try {
                await fetch(SHOP_CONFIG.SHEET_ENDPOINT, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                    body: JSON.stringify(payload)
                });
            } catch (err2) {
                console.error('[Kaha Shop] Sheet write failed entirely:', err2);
                return { ok: false, orderId: null };
            }
            return { ok: true, orderId: null };
        }
    }

    async function sendOrderEmail(d) {
        const payload = {
            access_key: SHOP_CONFIG.WEB3FORMS_KEY,
            subject: 'Kaha Shop order \u2014 ' + d.name,
            from_name: 'Kaha Shop',
            'Order': SHOP_CONFIG.PRODUCT_NAME + ' \u00D7 1',
            'Expected Amount': rupees(SHOP_CONFIG.UNIT_PRICE),
            'Full Name': d.name,
            'Email': d.email,
            'Phone Number': d.phone,
            'Address': [d.address1, d.address2].filter(Boolean).join(', '),
            'City': d.city,
            'State': d.state,
            'PIN Code': d.pincode,
            'Delivery Notes': d.notes || '-',
            'Check': 'Confirm a matching payment exists in your Razorpay dashboard before shipping'
        };

        try {
            const res = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(payload)
            });
            const out = await res.json();
            return res.ok && out.success;
        } catch (err) {
            console.error('[Kaha Shop] Could not email the order:', err);
            return false;
        }
    }

    document.getElementById('backToDelivery').addEventListener('click', function () {
        showStep('delivery');
    });

    /* ---------- step 3: payment ---------- */
    // Razorpay's script replaces the empty <form> with its own button. If it
    // hasn't after a few seconds, something blocked it — say so rather than
    // leaving the customer staring at a gap.
    setTimeout(function () {
        const wrap = document.getElementById('razorpayButtonWrap');
        const fallback = document.getElementById('payFallback');
        if (!wrap || !fallback) return;
        if (!wrap.querySelector('iframe, button, .razorpay-payment-button')) {
            fallback.hidden = false;
            console.error('[Kaha Shop] The Razorpay payment button did not render. Check that ' +
                'button pl_TVC7oYZyelKsEx is active in your Razorpay dashboard, and that the ' +
                'page is served over https.');
        }
    }, 6000);

    document.getElementById('paidAlready').addEventListener('click', function () {
        showStep('done');
    });

    /* ---------- step 4: done ---------- */
    document.getElementById('shopAgain').addEventListener('click', function () {
        deliveryForm.reset();
        setError(paymentError, '');
        setError(deliveryError, '');
        showStep('product');
    });

    /* ---------- boot ---------- */
    document.getElementById('unitPriceLabel').textContent =
        SHOP_CONFIG.UNIT_PRICE.toLocaleString('en-IN');
    fillSummaries();
});
