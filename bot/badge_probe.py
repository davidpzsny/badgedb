"""One-off probe: can a user's Twitch badge collection be read? (run by hand: Actions -> Badge probe)

Tries a handful of read-only Twitch GQL queries for a few public logins, once without login and once with the
helper account (TWITCH_GQL_OAUTH), and writes what came back to probe.json. About 20 requests in total.
Nothing is retried and no protection is worked around: an "integrity" error is simply recorded.
"""
import json, os, sys, datetime, requests

GQL = "https://gql.twitch.tv/gql"
CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"          # twitch.tv web client (same as the campaign lookup)
LOGINS = [x.strip().lower() for x in (sys.argv[1:] or ["1zull", "badge_db"]) if x.strip()]

FIELDS = {
    "displayBadges":   "displayBadges { setID version title }",
    "earnedBadges":    "earnedBadges { setID version title }",
    "selectedBadge":   "selectedBadge { setID version title }",
    "availableBadges": "availableBadges { setID version title }",
    "badges":          "badges { setID version title }",
}

def ask(query, variables, token=None):
    h = {"Client-Id": CLIENT_ID, "Content-Type": "application/json"}
    if token: h["Authorization"] = f"OAuth {token}"
    try:
        r = requests.post(GQL, json={"query": query, "variables": variables}, headers=h, timeout=20)
        try: body = r.json()
        except Exception: body = {"raw": r.text[:300]}
        return r.status_code, body
    except Exception as e:
        return 0, {"exception": str(e)[:300]}

def summarize(status, body, path):
    errs = [str(e.get("message", e))[:200] for e in (body.get("errors") or [])] if isinstance(body, dict) else []
    node = body.get("data") if isinstance(body, dict) else None
    for k in path:
        node = node.get(k) if isinstance(node, dict) else None
    if isinstance(node, list):
        return {"status": status, "errors": errs, "count": len(node), "sample": node[:5]}
    return {"status": status, "errors": errs, "value": node if node is None or isinstance(node, (dict, str, int)) else str(node)[:200],
            "raw": None if (errs or node is not None) else str(body)[:300]}

def main():
    token = (os.environ.get("TWITCH_GQL_OAUTH") or "").strip() or None
    out = {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"), "logins": LOGINS, "results": []}
    for auth in ([None, token] if token else [None]):
        label = "helper-account" if auth else "anonymous"
        for login in LOGINS:
            for name, sel in FIELDS.items():
                q = "query($login: String!) { user(login: $login) { id login " + sel + " } }"
                st, body = ask(q, {"login": login}, auth)
                res = summarize(st, body, ["user", name]); res.update(auth=label, login=login, field=name)
                out["results"].append(res); print(json.dumps(res, ensure_ascii=False)[:400])
        if auth:                                                  # the helper account's own collection (shows the shape when it works)
            st, body = ask("query { currentUser { login availableBadges { setID version title } } }", {}, auth)
            res = summarize(st, body, ["currentUser", "availableBadges"]); res.update(auth=label, login="(self)", field="currentUser.availableBadges")
            out["results"].append(res); print(json.dumps(res, ensure_ascii=False)[:400])
    json.dump(out, open("probe.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("probe.json written")

if __name__ == "__main__":
    main()
