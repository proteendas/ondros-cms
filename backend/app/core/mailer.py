"""Outbound email. SMTP when SMTP_HOST is configured; otherwise every message
is logged (dev mode) so flows remain fully usable locally — pair with
AUTH_DEV_MODE which also surfaces tokens in API responses.

Sending runs in a thread (smtplib is blocking) and never raises into the
request path: auth flows must not fail because a mail relay hiccuped.
"""
import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import get_settings

logger = logging.getLogger(__name__)


def _send_smtp(to: str, subject: str, html: str) -> None:
    settings = get_settings()
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg.attach(MIMEText(html, "html"))
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as server:
        server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


async def send_email(to: str, subject: str, html: str) -> None:
    settings = get_settings()
    if not settings.smtp_host:
        logger.info("EMAIL (dev, not sent) to=%s subject=%r\n%s", to, subject, html)
        return
    try:
        await asyncio.to_thread(_send_smtp, to, subject, html)
    except Exception:  # noqa: BLE001
        logger.exception("Email delivery failed to=%s subject=%r", to, subject)


def link_button(url: str, label: str) -> str:
    return (
        f'<p><a href="{url}" style="background:#4f46e5;color:#fff;padding:10px 22px;'
        f'border-radius:8px;text-decoration:none;font-family:sans-serif">{label}</a></p>'
        f'<p style="font-family:sans-serif;color:#667085;font-size:13px">Or open: {url}</p>'
    )
