"""GitHub OAuth2 relying-party helpers (spec 012).

GitHub is plain OAuth2 (no OIDC id_token), so identity comes from the REST
API after the code exchange: GET /user for the profile and GET /user/emails
for the primary *verified* address. Only verified emails are accepted —
an unverified mailbox must never mint an account.
"""
import httpx

AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
TOKEN_URL = "https://github.com/login/oauth/access_token"
API_BASE = "https://api.github.com"


class GitHubOAuthError(RuntimeError):
    pass


def build_authorize_url(client_id: str, redirect_uri: str, state: str) -> str:
    params = httpx.QueryParams(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": "read:user user:email",
            "state": state,
        }
    )
    return f"{AUTHORIZE_URL}?{params}"


async def exchange_code(
    client_id: str, client_secret: str, code: str, redirect_uri: str
) -> dict:
    """Exchange the code and fetch identity. Returns {email, name} with the
    primary verified email (GitHubOAuthError if there is none)."""
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
            },
            headers={"Accept": "application/json"},
        )
        if res.status_code != 200:
            raise GitHubOAuthError(f"GitHub token exchange failed ({res.status_code})")
        payload = res.json()
        access_token = payload.get("access_token")
        if not access_token:
            raise GitHubOAuthError(
                f"GitHub returned no access token: {payload.get('error_description') or payload.get('error') or 'unknown error'}"
            )

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        }
        profile_res = await client.get(f"{API_BASE}/user", headers=headers)
        if profile_res.status_code != 200:
            raise GitHubOAuthError(f"GitHub profile fetch failed ({profile_res.status_code})")
        profile = profile_res.json()

        email = profile.get("email")
        emails_res = await client.get(f"{API_BASE}/user/emails", headers=headers)
        if emails_res.status_code == 200:
            rows = emails_res.json()
            primary = next((r for r in rows if r.get("primary") and r.get("verified")), None)
            fallback = next((r for r in rows if r.get("verified")), None)
            chosen = primary or fallback
            if chosen:
                email = chosen["email"]
            elif rows:
                raise GitHubOAuthError("Your GitHub email address is not verified")

    if not email:
        raise GitHubOAuthError("GitHub did not return an email address")
    return {"email": email.lower(), "name": profile.get("name") or profile.get("login") or ""}
