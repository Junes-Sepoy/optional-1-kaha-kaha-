# Kaha Shop — setup

## Files

Upload these to the same folder as your other pages (`public_html`):

| File | What it does |
|---|---|
| `shop.html` | The page — product, delivery details, payment, confirmation |
| `styles.css` | Sitewide stylesheet, now covers the shop too. `shop.css` is no longer used and can be deleted |
| `shop.js` | Form validation; sends each order to your sheet and inbox |
| `cap.jpg` | The product photo |

`orders-sheet.gs` does **not** go on your website. It goes into Google Apps Script — see below.

No PHP, no API keys on the server.

## Price

₹1,499, delivery included. There is no separate delivery charge anywhere on the page now.

**Set payment button `pl_TVC7oYZyelKsEx` to ₹1,499 in your Razorpay dashboard.** The page displays ₹1,499 but the button charges whatever the dashboard says. Nothing in the code can catch a mismatch.

To change the price later, change it in both places: the Razorpay dashboard, and `UNIT_PRICE` in `shop.js`.

---

# The order database

Google Sheets can't be written to directly from a web page — there's no way to do it without exposing credentials that would let anyone edit your sheet. The standard approach, and the one used here, is a **Google Apps Script Web App**: a small script that lives with your spreadsheet, accepts orders, and writes the rows itself. Your credentials never leave Google.

## Setting it up (about five minutes)

1. **Create your Google Sheet.** Leave it empty — headers are written automatically on the first order.

2. **Extensions → Apps Script** from inside that sheet. Delete whatever's in the editor, paste in the whole of `orders-sheet.gs`, and save.

3. **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** — this must be "Anyone", *not* "Anyone with a Google account". Your website's visitors aren't signed in to Google.

   Authorise it when asked. Google shows a warning screen because the script is unpublished; click Advanced → Go to (project name).

4. **Copy the Web app URL.** It looks like `https://script.google.com/macros/s/AKfy.../exec`.

5. **Paste it into `shop.js`** as `SHEET_ENDPOINT`.

Test it before going live: open that URL in a browser. You should see `{"ok":true,...}`. Then place a test order on the site and watch the row appear.

**Whenever you edit the script, redeploy.** Deploy → Manage deployments → pencil icon → Version: **New version**. Without this, the live URL keeps running the old code. This catches everyone out at least once.

## Columns you get

Timestamp, Order ID, Name, Email, Phone, Address line 1, Address line 2, City, State, PIN code, Delivery notes, Product, Amount shown, Payment status, Razorpay payment ID, Shipped, Tracking number.

The last four are yours to fill in as you fulfil orders. Order IDs are sequential and human-readable: KM-0001, KM-0002. The customer sees theirs on the confirmation screen, so they can quote it in an email.

Add columns at the **right-hand end** if you want more. Inserting them in the middle will misalign what the script writes.

## Optional: block junk rows

Anyone who finds the URL could post to it. To prevent that, set `SHARED_TOKEN` in `orders-sheet.gs` to any random string, put the same string in `SHEET_TOKEN` in `shop.js`, and redeploy. Requests without it are rejected.

This isn't real security — the token is visible in your page source to anyone who looks. It stops drive-by bots, not a determined person. For a cap shop that's a sensible level.

## Two copies, on purpose

Every order is written to the sheet **and** emailed to `hello@kahamind.com`, independently. If one fails, the other still gets through and the customer sees nothing wrong. Only if both fail do they get asked to email you their address.

**Make a separate Web3Forms key for orders.** `shop.js` currently reuses your contact page's key, so orders land in the same inbox as therapy enquiries. Free at web3forms.com — swap `WEB3FORMS_KEY`.

---

## What this setup still can't do

Unchanged from before, and worth keeping in mind:

- **One cap per order.** A payment button charges a fixed amount and can't read a quantity from the page.
- **The page can't confirm payment.** Razorpay handles payment on its own screen and reports nothing back, so the last step says "order received" and the customer taps "I've completed the payment" themselves.
- **Rows are written before the money arrives.** The address is saved when the form is submitted, not when payment succeeds. So an abandoned checkout leaves a row marked "Awaiting payment" with no payment behind it. **Check Razorpay before shipping**, and update the Payment status column as you go.

That last one is the reason the sheet has a Payment status column rather than assuming every row is a real sale. If it becomes a nuisance, Razorpay's Standard Checkout can report success back to the page and mark rows automatically.

## Before going live

Razorpay checks for these during activation, and they're required for selling in India: Terms of Service, Privacy Policy, Refund/Cancellation Policy, Shipping Policy. Happy to draft them in the site's style.

The site also needs to be on `https://`. Bluehost gives you a free certificate under Security → SSL/TLS.
