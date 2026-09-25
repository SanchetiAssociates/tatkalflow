# TATKALFLOW — PHASE 4: JOURNEY CREATION & PREFERENCES

## 1. Phase boundary

Starting state:

- Phase 2 complete: 4b73f80
- Phase 3 complete: 7624bd5
- Current verified HEAD: 7624bd5
- Cloud migration verification completed successfully
- 174/174 existing tests pass
- Typecheck passes
- Production build passes

Phase 4 objective:

Build the complete Journey Creation / Journey Planning layer on top of the existing Phase 3 architecture.

Do NOT implement Phase 5.

Specifically, do NOT implement the full Tatkal date engine, Tatkal opening-date calculation engine, scheduler, automated booking, IRCTC integration, CAPTCHA handling, scraping or anti-bot circumvention.

A TatkalDateEngine interface/contract may be created for future use, but its full implementation must NOT be done in Phase 4.

---

## 2. Journey Template vs Journey Instance

Keep Journey Template and Journey Instance conceptually separate.

### Journey Template

A reusable user-defined journey configuration.

It may contain:

- journey name
- origin station
- destination station
- preferred trains
- class preferences
- boarding point preference
- quota preference
- passenger list
- berth preferences
- RAC/waitlist preferences
- auto-upgrade preference
- other booking preferences

### Journey Instance

A concrete planned journey created from a template.

It should snapshot the relevant configuration from the template at creation time so later template changes do not unexpectedly modify an existing journey.

Support:

- create journey from template
- create journey directly
- edit journey
- duplicate journey
- delete journey
- list journeys
- view journey summary
- view booking readiness

Avoid unnecessary duplication in the schema.

---

## 3. Database architecture

Review the existing Prisma schema first.

Add or modify models only where necessary.

The Phase 4 architecture should support:

- journey_templates
- journey_template_passengers
- journey_template_trains
- journey_template_classes
- journeys
- journey_passengers
- journey_trains
- journey_class_preferences

Do not blindly create duplicate structures if an existing Phase 2/3 model already provides the correct ownership or relationship.

Use proper foreign keys, ownership checks and cascading behaviour where appropriate.

All user-owned journey/template/passenger data must be protected by user ownership validation.

---

## 4. Journey creation

Implement a progressive mobile-first journey creation flow.

The user should be able to configure:

1. Journey name
2. From station
3. To station
4. Preferred trains
5. Boarding point where applicable
6. Quota
7. Class preference
8. Passenger selection
9. Berth preference
10. RAC/waitlist preference
11. Auto-upgrade preference

The UI should be usable on a phone first, while remaining responsive on desktop.

Do not require the user to configure every optional preference.

Provide sensible defaults where already established by the application specification.

---

## 5. Station selection

Use the existing station-search architecture.

Do not scrape IRCTC.

Development station data may remain fixture/mock data.

Do not introduce an external station API unless explicitly required.

Origin and destination must not silently resolve to the same station if the existing validation rules prohibit that.

---

## 6. Preferred trains

Support multiple preferred trains.

Each preferred train must have an explicit priority/order.

Example:

1. Train A
2. Train B
3. Train C

Implement:

- add preferred train
- remove preferred train
- reorder preferred trains
- persist priority
- display priority

Create a MockTrainDataProvider for development/test purposes.

Do not implement IRCTC train scraping.

Keep the train-provider abstraction suitable for a future real provider.

---

## 7. Class preferences

Default class priority:

1. 2A
2. 3A
3. 3E

Users must be able to reorder the preferred classes.

The class preference must preserve explicit priority.

Do not hard-code future railway rules in UI logic.

Use RailwayRulesService / rule registry for applicable railway rules.

---

## 8. Auto-upgradation

Support a journey-level auto-upgradation preference.

The preference must be explicitly stored and displayed.

It must be possible to enable or disable it.

Do not implement actual IRCTC booking/upgradation logic in Phase 4.

---

## 9. Berth preferences

Support the existing defined berth preference options.

Persist the user's selected preference for the journey/template.

Do not invent unsupported railway options.

Keep the model extensible for future rule changes.

---

## 10. RAC / waitlist preferences

Allow the user to specify whether RAC/waitlist outcomes are acceptable, according to the existing product design.

Persist this preference.

This is only a preference/configuration layer.

Do not implement actual ticket allocation or booking logic.

---

## 11. Passenger management within journeys

Allow existing passengers from the passenger master to be selected for a journey.

Support adding/removing passengers from the journey configuration.

Enforce the railway passenger limit through RailwayRulesService.

The current rule must remain rule-driven rather than hard-coded.

The Phase 4 specification requires support for the Tatkal passenger limit of maximum 4 passengers per PNR when the relevant rule is verified.

Do not bypass the rule if the rule registry marks it UNVERIFIED/MISSING.

The application should surface an appropriate readiness/rule warning instead.

---

## 12. Passenger name validation

Enforce the railway passenger-name restriction through RailwayRulesService.

The Phase 4 specification requires support for the 16-character passenger-name restriction.

Do not hard-code the number directly into unrelated UI components.

The validation should be rule-driven and testable.

---

## 13. Senior citizen concession

Tatkal senior citizen concession is unavailable.

Represent this through the appropriate rule/configuration architecture.

Do not allow the Phase 4 UI to imply that a senior citizen Tatkal concession can be selected.

Where the relevant railway rule is unverified, surface the appropriate rule-verification warning rather than silently claiming production certainty.

---

## 14. Rule snapshots

When a journey is created, snapshot relevant railway-rule/configuration versions used to construct the journey.

The journey should therefore retain the rule/configuration context that existed when it was created.

Do not rely exclusively on today's live rules when displaying historical journey configuration.

Use the existing RailwayRulesService and rule registry architecture.

---

## 15. Journey summary

After journey creation, provide a clear journey summary containing, where applicable:

- journey name
- origin
- destination
- selected passengers
- preferred trains and their priority
- class preferences and priority
- quota
- boarding point
- berth preference
- RAC/waitlist preference
- auto-upgrade preference
- relevant railway-rule warnings
- booking-readiness status

The summary must be mobile-friendly.

---

## 16. Booking readiness preview

Implement a booking-readiness preview/checklist.

The readiness preview should identify whether the journey is sufficiently configured for the future booking phase.

Check items should include, as applicable:

- origin configured
- destination configured
- passengers configured
- passenger validation passed
- passenger count within applicable rule
- IRCTC User ID linked/configured
- class preference configured
- train preference configured where required
- journey preferences configured
- relevant railway rules verified/unverified
- other required configuration

Clearly distinguish:

READY

from

WARNING / NOT READY

Do not claim that a journey is ready to book if required railway rules are UNVERIFIED or MISSING.

This is a readiness/configuration feature only.

It does not book tickets.

---

## 17. TatkalDateEngine

Create only the interface/contract needed for future Phase 5 integration if useful.

Example responsibility:

- determine Tatkal opening date/time from a journey date and railway rules

But DO NOT implement the full Tatkal date engine in Phase 4.

No production date calculations should be introduced here.

---

## 18. API architecture

Follow the existing Fastify architecture.

Implement appropriate authenticated routes/services for:

- journey templates
- journey template passengers
- journey template trains
- journey template classes
- journeys
- journey passengers
- journey trains
- journey class preferences
- journey readiness/summary where appropriate

Every endpoint must enforce ownership.

Never trust user-supplied user IDs.

Use the authenticated session identity.

Validate all request payloads with the existing shared Zod/schema architecture.

---

## 19. Web architecture

Use the existing React/TypeScript/Tailwind/shadcn architecture.

Implement a progressive mobile-first UX.

Avoid building one huge form.

Use logical steps/sections with clear navigation and validation.

Support:

- create
- edit
- duplicate
- delete
- list
- detail/summary

Use accessible controls and clear validation/error states.

---

## 20. Security

Preserve all existing Phase 2/3 security guarantees.

Do not introduce:

- IRCTC password storage
- payment OTP storage
- UPI PIN storage
- CVV storage
- CAPTCHA solving
- CAPTCHA bypass
- scraping
- anti-bot circumvention
- unauthorized browser automation
- automated IRCTC booking

Do not weaken existing authentication, CSRF, rate limiting, ownership checks, audit logging or secret handling.

---

## 21. Testing

Add comprehensive tests for Phase 4.

At minimum test:

### Shared/domain

- journey validation
- passenger limits
- passenger-name validation
- class priority
- train priority
- auto-upgrade preference
- berth preference
- RAC/waitlist preference
- rule snapshot structures

### API

- authentication required
- ownership enforcement
- template CRUD
- journey CRUD
- duplicate journey
- passenger association
- train association
- class association
- validation errors
- readiness calculation

### Web

- journey creation flow
- editing
- duplication
- deletion
- passenger selection
- train priority
- class priority
- readiness display
- validation/error states

Do not modify existing tests merely to make them pass.

---

## 22. Development data

Station and train data may remain mock/fixture data for development.

Do not add external scraping.

Do not require live IRCTC access.

---

## 23. Documentation

Update README/documentation to reflect Phase 4 once implementation is complete.

Document any new setup requirements discovered during implementation.

Preserve the Phase 4 specification document as:

docs/phase-4-journey-creation.md

---

## 24. Git workflow

Work on the current Claude feature branch.

Do not modify main directly.

Commit logical Phase 4 changes with clear commit messages.

At completion:

1. Run all existing tests.
2. Run all new tests.
3. Run typecheck.
4. Run production build.
5. Verify working tree.
6. Review the diff.
7. Provide a detailed Phase 4 completion report.
8. Prepare a PR against main.

Do not merge the PR automatically.

---

## 25. Completion criteria

Phase 4 is complete only when:

- Journey templates work.
- Journey instances work.
- Template and instance configuration are appropriately separated.
- Passengers can be selected and validated.
- Preferred trains work with explicit priority.
- Class preferences work with explicit priority.
- Default class priority is 2A → 3A → 3E.
- Auto-upgrade preference works.
- Berth preference works.
- RAC/waitlist preference works.
- Passenger limit is rule-driven.
- Passenger-name validation is rule-driven.
- Senior citizen Tatkal concession is correctly represented.
- Relevant rule snapshots are stored.
- Journey summary works.
- Booking readiness preview works.
- Ownership/security tests pass.
- API tests pass.
- Web tests pass.
- Typecheck passes.
- Production build passes.
- No CAPTCHA/scraping/IRCTC automation has been introduced.
- Full TatkalDateEngine implementation has NOT been introduced.
- Phase 5 has NOT started.

STOP at the end of Phase 4 and wait for approval.
