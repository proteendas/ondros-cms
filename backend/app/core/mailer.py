"""Outbound email — verification, password reset and invitations.

Four transports, selected by MAIL_PROVIDER (or auto-detected in this order):

  resend  HTTP API, api.resend.com     — free tier, nothing to install
  brevo   HTTP API, api.brevo.com      — free tier
  smtp    any relay (Mailgun, SendGrid, Gmail, self-hosted)
  log     write the message to the log instead of sending it

HTTP providers are the default preference because several PaaS hosts block or
throttle outbound SMTP ports, which fails in a way that looks like the app
being broken rather than the network refusing the connection.

Sending NEVER raises into the request path: an auth flow must not fail because
a mail relay hiccuped. Failures are logged, and with AUTH_DEV_MODE the action
token is also returned in the API response, so local flows stay usable with no
mail provider at all.
"""
import asyncio
import logging
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

SEND_TIMEOUT_S = 15

RESEND_ENDPOINT = "https://api.resend.com/emails"
BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email"

# "Ondros CMS <no-reply@x.com>" -> ("Ondros CMS", "no-reply@x.com")
_FROM_RE = re.compile(r"^\s*(?P<name>.*?)\s*<(?P<email>[^>]+)>\s*$")


def split_sender(value: str) -> tuple[str, str]:
    """Split a From header into (display name, address).

    Providers with a JSON API want the two parts separately; SMTP takes the
    combined header. A bare address yields an empty name.
    """
    match = _FROM_RE.match(value or "")
    if match:
        return match.group("name"), match.group("email")
    return "", (value or "").strip()


def _send_smtp(to: str, subject: str, html: str) -> None:
    settings = get_settings()
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.mail_sender
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=SEND_TIMEOUT_S) as server:
        server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


async def _send_resend(to: str, subject: str, html: str) -> None:
    settings = get_settings()
    payload = {
        "from": settings.mail_sender,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    async with httpx.AsyncClient(timeout=SEND_TIMEOUT_S) as client:
        res = await client.post(
            RESEND_ENDPOINT,
            json=payload,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        )
    # 403 here almost always means the From domain isn't verified yet; say so
    # rather than leaving a bare status code in the log.
    if res.status_code >= 400:
        raise RuntimeError(
            f"Resend rejected the message ({res.status_code}): {res.text[:300]}"
        )


async def _send_brevo(to: str, subject: str, html: str) -> None:
    settings = get_settings()
    name, address = split_sender(settings.mail_sender)
    payload = {
        "sender": {"email": address, **({"name": name} if name else {})},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }
    async with httpx.AsyncClient(timeout=SEND_TIMEOUT_S) as client:
        res = await client.post(
            BREVO_ENDPOINT,
            json=payload,
            headers={"api-key": settings.brevo_api_key, "accept": "application/json"},
        )
    if res.status_code >= 400:
        raise RuntimeError(
            f"Brevo rejected the message ({res.status_code}): {res.text[:300]}"
        )


async def send_email(to: str, subject: str, html: str) -> None:
    """Deliver one message. Logs and swallows every failure by design."""
    settings = get_settings()
    provider = settings.resolved_mail_provider

    if provider == "log":
        logger.info("EMAIL (not sent — no mail provider) to=%s subject=%r\n%s", to, subject, html)
        return

    try:
        if provider == "resend":
            await _send_resend(to, subject, html)
        elif provider == "brevo":
            await _send_brevo(to, subject, html)
        elif provider == "smtp":
            # smtplib is blocking, so keep it off the event loop.
            await asyncio.to_thread(_send_smtp, to, subject, html)
        else:
            logger.error("Unknown MAIL_PROVIDER %r — falling back to logging", provider)
            logger.info("EMAIL (not sent) to=%s subject=%r\n%s", to, subject, html)
            return
        logger.info("Email sent via %s to=%s subject=%r", provider, to, subject)
    except Exception:  # noqa: BLE001 - never break an auth flow over mail
        logger.exception(
            "Email delivery failed via %s to=%s subject=%r", provider, to, subject
        )


def link_button(url: str, label: str) -> str:
    return (
        f'<p><a href="{url}" style="background:#4f46e5;color:#fff;padding:10px 22px;'
        f'border-radius:8px;text-decoration:none;font-family:sans-serif">{label}</a></p>'
        f'<p style="font-family:sans-serif;color:#667085;font-size:13px">Or open: {url}</p>'
    )
