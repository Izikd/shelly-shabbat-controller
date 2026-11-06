# Network path (reverse proxy / tunnel)

Learned on a **Shelly Pro 1, firmware 2.0.3** (Nov 2026) unless noted. Each note says how it
is known: *doc* (Shelly API docs), *measured* (see `../experiments/`), *observed* (happened on
the device) or *design* (a rule we chose). Recheck on new firmware or other models.

- Through a reverse proxy / tunnel, each RPC round trip took 0.4-1.3 s, so load time depends
  on the number of sequential requests far more than on bytes (*measured*).
- Some proxies (e.g. a WAF in front of a tunnel) reject Python's default `Python-urllib`
  user agent with 403 (*observed*); `deploy.py` sends its own.
