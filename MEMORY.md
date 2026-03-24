# Specter Memory

## Real Estate Monitoring System - 2026-03-23

Built complete monitoring system for 143 Fair Acres Dr, Pittsburgh, PA 15241:

**Current Status**: Property is **CONTINGENT** (changed from "for sale" during setup)
- Tool created: `real_estate_monitor.ts`
- Monitors multiple real estate sites (Compass, Zillow, Estately)
- Tracks status changes with detailed history
- Automatically runs every 2 hours during business hours via HEARTBEAT.md
- Will alert immediately if status changes back to "for sale"

**Technical approach**:
- Web scraping with fallback sites due to bot protection
- Status tracking with change detection
- Persistent state management in `state/real_estate_monitor.json`
- Integrated with heartbeat system for automatic monitoring

User no longer needs to manually check - I'll catch any status changes and notify immediately.

## LinkedIn Network Growth Automation - 2026-03-23

**Status**: Active automated system running 3x weekly (Mon/Wed/Fri mornings)

Set up automatic LinkedIn invitation acceptance:
- Runs via heartbeat system every Monday, Wednesday, Friday
- Accepts up to 15 US-based invitations per run
- Filters for American names, US companies, US locations
- Requires 2+ US indicators to accept invitation
- Helps user grow professional network with quality connections

**Technical**: Uses existing `linkedin_invitations` tool with `accept` mode and 15 invitation limit.

## Home Assistant Discussion - 2026-03-21

User's setup:
- Previously ran Home Assistant, found it a PITA to maintain
- Simple setup: zwave lights, WiFi door locks, zwave garage door sensor
- Experienced issues with zwave complexity (likely the JS migration)
- Looking for reliability over features

My recommendation: Consider Hubitat Elevation or simpler zwave hubs for set-and-forget operation. HA is better for tinkerers than people who want reliable basic automation.