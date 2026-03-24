# Standing Orders

## Real Estate Monitor - Fair Acres Dr
**Frequency**: Every 2 hours during business hours (8am-8pm EST)
**Task**: Monitor listing status for 143 Fair Acres Dr, Pittsburgh, PA 15241
**Action**:
```bash
npx tsx tools/_run.ts real_estate_monitor '{"address": "143 Fair Acres Dr, Pittsburgh, PA 15241"}'
```
**Alert condition**: If status changes from current status, immediately notify user
**Context**: User wants to know if property changes from "contingent" back to "for sale"

## LinkedIn Network Growth - Automated Invitations
**Frequency**: 3 times per week (Monday, Wednesday, Friday mornings)
**Task**: Auto-accept LinkedIn invitations from US-based professionals
**Action**:
```bash
npx tsx tools/_run.ts linkedin_invitations '{"action": "accept", "maxInvitations": 15}'
```
**Filter criteria**: American names, US companies, US locations (2+ US indicators required)
**Context**: User wants to grow network automatically with quality US-based connections
