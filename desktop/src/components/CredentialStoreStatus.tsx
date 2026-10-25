import { useEffect, useState } from "react";
import { secretStatus, type SecretStatus } from "../lib/api";

/** Says where proxy passwords and header credentials are really kept, instead of assuming a password store exists. */
export default function CredentialStoreStatus() {
  const [status, setStatus] = useState<SecretStatus | null | "failed">(null);
  useEffect(() => {
    let live = true;
    secretStatus().then((s) => live && setStatus(s), () => live && setStatus("failed"));
    return () => { live = false; };
  }, []);
  if (status === null) return <p className="pref-hint mt-1.5 mb-0" role="status">Checking the system password store…</p>;
  if (status === "failed") return <p className="pref-hint mt-1.5 mb-0" role="status">Kaisu couldn't check the system password store.</p>;
  if (status.available) {
    return <p className="pref-hint mt-1.5 mb-0" role="status" aria-label="Password store status">Passwords are kept in {status.store}, not in Kaisu's settings file, and are hidden here until you edit the box. Private header values in custom arguments are kept there too.</p>;
  }
  return (
    <p className="mt-1.5 mb-0" role="alert" aria-label="Password store status" style={{ color: "#b3261e" }}>
      {status.store} isn't available on this computer{status.detail ? ` (${status.detail})` : ""}. Until it is, a proxy password stays in Kaisu's settings file, and private header values in custom arguments are not remembered after Kaisu closes.
    </p>
  );
}
