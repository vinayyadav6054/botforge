"use client";

import { motion } from "motion/react";
import QRCode from "qrcode";
import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, Plan } from "@/lib/api";
import { site } from "@/lib/site";

/**
 * Pay for a plan by UPI with no payment gateway and no fees: a QR (or "Open UPI app" on phones) for the exact amount,
 * then the owner sends the UPI reference; the Kahiye team checks it and switches the plan on (Admin page).
 */
export default function UpiPay({ plan, amount, account, onClose }: { plan: Plan; amount: number; account: string; onClose: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [utr, setUtr] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");
  const note = `Kahiye ${plan.name} ${account}`.slice(0, 60);
  const link = `upi://pay?pa=${encodeURIComponent(site.upiId)}&pn=${encodeURIComponent(site.upiName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;

  useEffect(() => {
    QRCode.toDataURL(link, { width: 240, margin: 1, color: { dark: "#0b1020", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [link]);

  async function confirmPaid(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      await api.support("Billing and payment",
        `Paid ₹${amount} by UPI for the ${plan.name} plan.
UPI reference (UTR): ${utr.trim()}
Account: ${account}`);
      setState("sent");
    } catch (err) {
      setState((err as Error).message);
    }
  }

  return createPortal(
    <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={`Pay for ${plan.name}`} onClick={onClose}>
      <motion.div className="modal upi" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 26 }}>
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        {state === "sent" ? (
          <div className="upi-done">
            <div className="upi-check" aria-hidden>✓</div>
            <h2>Thank you!</h2>
            <p className="muted">We will check the payment and switch on your {plan.name} plan, usually within a few hours. It shows on this page as soon as it is on.</p>
            <button className="btn block" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <h2>Pay ₹{amount.toLocaleString("en-IN")} for {plan.name}</h2>
            <p className="muted small">Scan with any UPI app: GPay, PhonePe, Paytm, BHIM or your bank&apos;s app. One month, no auto-debit.</p>
            <div className="upi-qr">{qr ? <img src={qr} alt={`UPI QR code to pay ₹${amount} to ${site.upiName}`} width={240} height={240} /> : <span className="spinner" />}</div>
            <p className="upi-id">UPI ID: <strong>{site.upiId}</strong> · {site.upiName}</p>
            <a className="btn block only-phone-flex" href={link}>Open UPI app</a>
            <form onSubmit={confirmPaid} className="upi-form">
              <label htmlFor="utr">After paying, enter the UPI reference number (UTR)</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input id="utr" type="text" inputMode="numeric" required minLength={6} maxLength={30} value={utr}
                  onChange={(e) => setUtr(e.target.value.replace(/[^0-9A-Za-z]/g, ""))} placeholder="e.g. 412345678901" />
                <button className="btn" type="submit" disabled={state === "sending" || utr.length < 6}>{state === "sending" ? "Sending…" : "I have paid"}</button>
              </div>
              <span className="small muted">You find it in your UPI app under the payment details.</span>
            </form>
            {state !== "idle" && state !== "sending" && <div className="alert error" role="alert">{state}</div>}
          </>
        )}
      </motion.div>
    </div>
  , document.body);
}
