# Optional settings shared by every deploy target (sourced by start.sh, after the required ones).
# Friendly names in the hosting dashboard -> the settings each service reads.

# Public address of the dashboard: email links (password reset, verification, reports) and the widget badge link
if [ -n "${PUBLIC_URL:-}" ]; then
  export App__DashboardUrl="${PUBLIC_URL%/}" BRANDING_URL="${PUBLIC_URL%/}"
fi

# Email (any SMTP account: Gmail app password, Brevo, Resend, Zoho). Without it emails only go to the log.
if [ -n "${SMTP_HOST:-}" ]; then
  export Email__Smtp__Host="$SMTP_HOST" Email__Smtp__Port="${SMTP_PORT:-587}" \
    Email__Smtp__User="${SMTP_USER:-}" Email__Smtp__Password="${SMTP_PASSWORD:-}"
fi
[ -z "${EMAIL_FROM:-}" ] || export Email__From="$EMAIL_FROM"

# Online payments (Razorpay subscriptions). Without them, plans are activated on the /admin page.
[ -z "${RAZORPAY_KEY_ID:-}" ] || export Razorpay__KeyId="$RAZORPAY_KEY_ID"
[ -z "${RAZORPAY_KEY_SECRET:-}" ] || export Razorpay__KeySecret="$RAZORPAY_KEY_SECRET"
[ -z "${RAZORPAY_WEBHOOK_SECRET:-}" ] || export Razorpay__WebhookSecret="$RAZORPAY_WEBHOOK_SECRET"
[ -z "${RAZORPAY_PLAN_STARTER:-}" ] || export Razorpay__Plans__starter="$RAZORPAY_PLAN_STARTER"
[ -z "${RAZORPAY_PLAN_BUSINESS:-}" ] || export Razorpay__Plans__business="$RAZORPAY_PLAN_BUSINESS"
[ -z "${RAZORPAY_PLAN_PRO:-}" ] || export Razorpay__Plans__pro="$RAZORPAY_PLAN_PRO"

# The platform owner's key for the /admin page (set plans after UPI payments). Admin is off without it.
[ -z "${ADMIN_API_KEY:-}" ] || export Admin__ApiKey="$ADMIN_API_KEY"

# identity -> bots (account deletion, monthly reports); all services run in this one container
export Services__BotsUrl=http://127.0.0.1:5215
