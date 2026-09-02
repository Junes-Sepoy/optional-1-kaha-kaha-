/* ============================================================================
   Kaha Shop — checkout
   ----------------------------------------------------------------------------
   HOW THIS WORKS

   1. The customer fills in their delivery details.
   2. The Razorpay hosted payment button takes the payment. It cannot report
      back to the page, so the customer presses "I've completed the payment"
      and the order is recorded then. Always check Razorpay before shipping.
   3. Once Razorpay reports success, the order is recorded three ways, all
      attempted independently so one failing never loses the order:
        - an email to hello@kahamind.com with everything
        - an email to the buyer with their copy
        - a row in the Google Sheet (once SHEET_ENDPOINT is filled in)

   IMPORTANT: the amount charged is set in your Razorpay dashboard against
   payment button pl_TVC7oYZyelKsEx, NOT in this file. UNIT_PRICE below is
   only what the page displays. Keep the two in step, or the page will show
   a customer one figure and charge them another.
   ========================================================================== */

const SHOP_CONFIG = {
    // ---- order database ----------------------------------------------------
    // Google Sheet Web app URL from deploying orders-sheet.gs.
    // Leave blank and the sheet is skipped; the emails still send.
    SHEET_ENDPOINT: '',
    SHEET_TOKEN: '',

    // ---- email -------------------------------------------------------------
    // Web3Forms key for the copy that comes to you.
    WEB3FORMS_KEY: '37b5f01a-e781-4f14-9931-036def961192',

    // Web3Forms key used for the buyer's copy. See the note at the bottom of
    // this file: this must be a form whose autoresponder is switched on, or
    // the buyer will not receive anything.
    WEB3FORMS_BUYER_KEY: '',

    TEAM_EMAIL: 'hello@kahamind.com',

    // ---- product -----------------------------------------------------------
    PRODUCT_NAME: 'Metal Health Cap',
    UNIT_PRICE: 1499          // rupees, shown on the page and charged
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

    const order = { customer: {}, id: null, paymentId: null };

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

    /* a readable reference the customer can quote at us */
    function makeOrderId() {
        const d = new Date();
        const stamp = String(d.getFullYear()).slice(2) +
                      String(d.getMonth() + 1).padStart(2, '0') +
                      String(d.getDate()).padStart(2, '0');
        const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
        return 'KM-' + stamp + '-' + tail;
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
    deliveryForm.addEventListener('submit', function (e) {
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
                            return setError(deliveryError, 'Enter a 10-digit Indian mobile number, the courier will call it.');
        if (!data.address1) return setError(deliveryError, 'Add the first line of your address.');
        if (!data.city)     return setError(deliveryError, 'Add your city.');
        if (!data.state)    return setError(deliveryError, 'Pick your state.');
        if (!/^\d{6}$/.test(data.pincode))
                            return setError(deliveryError, 'PIN codes are 6 digits. Check yours and try again.');

        order.customer = data;
        order.id = makeOrderId();

        // nothing is recorded yet: the order only exists once it is paid for
        const addressBox = document.getElementById('summaryAddress');
        if (addressBox) {
            addressBox.innerHTML = [
                data.name, data.address1, data.address2,
                data.city + ', ' + data.state + ' ' + data.pincode, data.phone
            ].filter(Boolean).join('<br>');
        }

        document.getElementById('doneName').textContent  = data.name.split(' ')[0];
        document.getElementById('doneEmail').textContent = data.email;

        fillSummaries();
        showStep('payment');
    });

    document.getElementById('backToDelivery').addEventListener('click', function () {
        showStep('delivery');
    });

    /* ---------- step 3: payment ----------
       The Razorpay hosted payment button takes the payment. It renders in
       an iframe and reports nothing back to the page, so the customer tells
       us when they are done, and we record the order then. Check the payment
       exists in your Razorpay dashboard before shipping. */
    (function setUpPayment() {
        const hostedWrap = document.getElementById('razorpayButtonWrap');

        // if the button has not rendered after a few seconds, something
        // blocked it: say so rather than leaving a gap on the page
        setTimeout(function () {
            const fallback = document.getElementById('payFallback');
            if (!hostedWrap || !fallback) return;
            if (!hostedWrap.querySelector('iframe, button, .razorpay-payment-button')) {
                fallback.hidden = false;
                console.error('[Kaha Shop] The payment button did not render. Check that ' +
                    'button pl_TVC7oYZyelKsEx is active in your Razorpay dashboard, and that ' +
                    'the page is served over https.');
            }
        }, 6000);

        const paidBtn = document.getElementById('paidAlready');
        if (paidBtn) {
            paidBtn.addEventListener('click', function () {
                completeOrder();
            });
        }
    })();

    /* ---------- step 4: the order is paid for ---------- */
    async function completeOrder() {
        // show the confirmation immediately: the customer has paid and should
        // not wait on our record keeping
        const ref = document.getElementById('doneOrderId');
        if (ref) ref.textContent = order.id;
        const refLine = document.getElementById('doneOrderLine');
        if (refLine) refLine.hidden = false;

        showStep('done');

        const result = await recordOrder();

        if (!result.sheet && !result.teamEmail) {
            // both records failed, so ask the customer to nudge us
            const box = document.getElementById('doneWarning');
            if (box) {
                box.textContent = 'Your payment went through, but we could not save your address ' +
                    'automatically. Please email ' + SHOP_CONFIG.TEAM_EMAIL + ' with your order number ' +
                    'so we know where to send the cap.';
                box.hidden = false;
            }
        }
    }

    /* ---------- recording an order ----------
       Three destinations, all attempted at once. This is also the shape the
       Google Sheet will store, so wiring the sheet up later is just a matter
       of filling in SHEET_ENDPOINT. */
    function orderRecord() {
        const d = order.customer;
        return {
            order_id: order.id,
            placed_at: new Date().toISOString(),
            product: SHOP_CONFIG.PRODUCT_NAME + ' \u00D7 1',
            amount: String(SHOP_CONFIG.UNIT_PRICE),
            payment_status: 'Paid (confirmed by customer)',
            razorpay_payment_id: order.paymentId || '',
            name: d.name,
            email: d.email,
            phone: d.phone,
            address1: d.address1,
            address2: d.address2,
            city: d.city,
            state: d.state,
            pincode: d.pincode,
            notes: d.notes
        };
    }

    async function recordOrder() {
        const [sheet, teamEmail, buyerEmail] = await Promise.all([
            sendToSheet().catch(() => ({ ok: false })),
            sendTeamEmail().catch(() => false),
            sendBuyerEmail().catch(() => false)
        ]);
        return { sheet: sheet.ok, teamEmail: teamEmail, buyerEmail: buyerEmail };
    }

    async function sendToSheet() {
        if (!SHOP_CONFIG.SHEET_ENDPOINT) return { ok: false };

        const payload = Object.assign({ token: SHOP_CONFIG.SHEET_TOKEN }, orderRecord());

        // text/plain keeps this a "simple" request, so the browser skips the
        // CORS preflight that Apps Script cannot answer.
        try {
            const res = await fetch(SHOP_CONFIG.SHEET_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });
            const out = await res.json();
            return { ok: !!out.ok };
        } catch (err) {
            // some Apps Script deployments block reading the response even
            // though the write succeeds: resend blind so the row still lands
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
                return { ok: false };
            }
            return { ok: true };
        }
    }

    /* the copy that comes to Kaha Mind */
    async function sendTeamEmail() {
        const r = orderRecord();
        return post('https://api.web3forms.com/submit', {
            access_key: SHOP_CONFIG.WEB3FORMS_KEY,
            subject: 'Kaha Shop order ' + r.order_id + ' \u2014 ' + r.name,
            from_name: 'Kaha Shop',
            'Order Number': r.order_id,
            'Placed': r.placed_at,
            'Order': r.product,
            'Amount Paid': rupees(SHOP_CONFIG.UNIT_PRICE),
            'Payment Status': r.payment_status,
            'Razorpay Payment ID': r.razorpay_payment_id,
            'Full Name': r.name,
            'Email': r.email,
            'Phone Number': r.phone,
            'Address': [r.address1, r.address2].filter(Boolean).join(', '),
            'City': r.city,
            'State': r.state,
            'PIN Code': r.pincode,
            'Delivery Notes': r.notes || '-'
        });
    }

    /* the copy that goes to the buyer */
    async function sendBuyerEmail() {
        const key = SHOP_CONFIG.WEB3FORMS_BUYER_KEY || SHOP_CONFIG.WEB3FORMS_KEY;
        const r = orderRecord();

        return post('https://api.web3forms.com/submit', {
            access_key: key,
            subject: 'Your Kaha Mind order ' + r.order_id,
            from_name: 'Kaha Mind',

            // Web3Forms sends its autoresponse to the address in this field,
            // so it has to be named exactly this
            email: r.email,
            name: r.name,

            'Order Number': r.order_id,
            'Item': r.product,
            'Amount Paid': rupees(SHOP_CONFIG.UNIT_PRICE),
            'Payment Reference': r.razorpay_payment_id,
            'Delivering To': [r.name, r.address1, r.address2,
                              r.city + ', ' + r.state + ' ' + r.pincode,
                              r.phone].filter(Boolean).join(', '),
            'Questions': 'Reply to this email or write to ' + SHOP_CONFIG.TEAM_EMAIL
        });
    }

    async function post(url, payload) {
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(payload)
            });
            const out = await res.json();
            return res.ok && out.success;
        } catch (err) {
            console.error('[Kaha Shop] Email failed:', err);
            return false;
        }
    }

    /* ---------- back to the shop ---------- */
    document.getElementById('shopAgain').addEventListener('click', function () {
        deliveryForm.reset();
        setError(paymentError, '');
        setError(deliveryError, '');
        const warn = document.getElementById('doneWarning');
        if (warn) warn.hidden = true;
        order.id = null;
        order.paymentId = null;
        showStep('product');
    });

    /* ---------- boot ---------- */
    document.getElementById('unitPriceLabel').textContent =
        SHOP_CONFIG.UNIT_PRICE.toLocaleString('en-IN');
    fillSummaries();
});

/* ============================================================================
   NOTE ON THE BUYER'S EMAIL

   Web3Forms delivers submissions to the address that owns the access key, so
   a plain submission only ever reaches Kaha Mind. To also email the buyer,
   the form behind WEB3FORMS_BUYER_KEY needs its autoresponder ("Send a copy
   to the submitter" / Email Template) switched on in the Web3Forms dashboard,
   and the message written there. The submission above supplies the buyer's
   address in the `email` field, which is what the autoresponder replies to.

   If autoresponder is not available on your plan, the alternatives are a
   transactional email service (Resend, Postmark, SendGrid) called from a
   small server endpoint, or sending the buyer's copy from the Apps Script
   that writes the Google Sheet, using MailApp.sendEmail. The second is free
   and fits the sheet work that is coming next.
   ========================================================================== */
