# Script code storage: GetCode / PutCode

Learned on a **Shelly Pro 1, firmware 2.0.3** (Nov 2026) unless noted. Each note says how it
is known: *doc* (Shelly API docs), *measured* (see `../experiments/`), *observed* (happened on
the device) or *design* (a rule we chose). Recheck on new firmware or other models.

- **`GetCode` offset and `len` are in bytes** (*doc*, *observed*).
- **A UTF-8 character split across two reads comes back as U+FFFD** in the piece that holds the partial character
  (*observed*). Hence pure-ASCII builds.
- **A read costs the device about twice its size in RAM at the peak** (*measured*):
  8 KB +13 KB, 16 KB +35 KB, 32 KB +39 KB; 4 KB pieces, 3-5 in parallel, +6-10 KB.
- **One ~28 KB read rebooted the device** (*observed*, `reset_reason` 4) while it had ~110 KB
  free. Keep reads at 4 KB.
- **A read past the end** returns `{code: -103, message: "Invalid argument 'offset':
  Exceeds file size!"}`; a read exactly at the end returns empty data (*observed*).
- **`PutCode` rejects JSON `\u` escapes in the request** with `-103 Missing or bad argument
  'code'` (*observed*): send the body as raw UTF-8. Escaped text in the code itself (a
  literal backslash-u, as in the ASCII page) is fine.
- **`PutCode` must not be retried blindly with `append`**: if the reply was lost the chunk may
  already be applied. `deploy.py` re-reads the code length and resumes (*design*).
- The code of a running script cannot be replaced; stop it first (*doc*). The mock refuses it
  too.
- **Uploading from the settings page** (*design*, not yet tried on hardware): the page's
  Check for updates uses the same steps as `deploy.py` - 1 KB `PutCode` pieces as a JSON
  `POST` body, resume from the reported length after a lost reply, read back with 4 KB
  `GetCode` pieces and compare, controller stopped only for its own upload, old code put back
  if anything fails after the stop. Not known yet: what `Script.Start` answers on a device
  for code that fails to parse (the mock answers an error, which triggers the restore).
