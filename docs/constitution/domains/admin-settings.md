# Domain Constitution — Admin & Settings

> Status: draft

## Scope
- roles
- permissions
- system lists
- settings
- admin configuration

## To be filled
- definitions
- rules
- UI contract
- API contract
- edge cases

## Mobile Application Content Settings

### Contact links

- The mobile application's Facebook, Website, Instagram, WhatsApp, and Telegram
  destinations are one global configuration, not branch-owned records.
- Administration and mobile consumption are separate surfaces. Staff management
  requires `admin.app_contact_links.view` or `admin.app_contact_links.manage`;
  the mobile read surface may be consumed by guests and authenticated customers.
- The five platform keys are stable. A null value means that the mobile client
  hides that platform; absence of a key must not be used as the disable signal.
- Facebook, Website, and Instagram accept normalized HTTPS URLs only. WhatsApp
  and Telegram accept canonical E.164 phone numbers only.
- The full configuration is replaced atomically, validated on the server, and
  audited with old/new snapshots and the acting staff identity.
- Contact links are independent from home-banner tap targets. Neither contract
  may be extended implicitly from the other.
