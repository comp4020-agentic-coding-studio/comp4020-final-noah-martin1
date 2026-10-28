# Repository Architectural Guidelines & Rules

> This file contains the complete, long-term project architecture, workflows, and invariants. 
> Refer to this file when executing system overhauls, UI changes, or infrastructure updates.

## 1. Project overview

This is an existing meal-planning and cooking application. The goal is to refine the current product, fix bugs, and improve consistency without unnecessarily rebuilding working features.

The application includes accounts, friends, recipes, personal and shared pantries, meal calendars, shopping lists, cooking mode, live cooking, household features, meal planning, and budget-aware suggestions.

Treat the repository's existing implementation, tests, data models, and documented invariants as the starting point. Inspect them before deciding how to change a feature.

## 2. Non-negotiable invariants

These rules apply to every change. Do not violate them to make a feature easier to implement.

- **Preserve the built-in checks.** `/` must answer with HTTP 200 directly, without a redirect. `/readme/` must server-render every README heading in order. Do not edit or delete `spec/invariants.test.ts`.
- **Centralise visibility decisions.** Every visibility decision goes through `src/visibility.ts`. Routes must not write their own visibility SQL. A hidden recipe, entry, or cook session returns 404, never 403, so strangers cannot learn that it exists.
- **Escape HTML safely.** All HTML goes through the `html` tagged template in `src/html.ts`, which escapes by default. Use `raw()` only for trusted content written by the application, never for user-provided content.
- **Use parameterised SQL.** Never concatenate user input into SQL query strings.
- **Use new migrations for schema changes.** Add a new numbered file in `src/migrations/`. Never edit a migration that has shipped; migrations 001–003 have shipped.
- **Persist durable data only in `$DATA_DIR`.** On Fly, this is `/data`. Do not introduce another durable storage location without an explicit, approved architectural decision.
- **Test safely.** New invariants need tests in `spec/`. Run HTTP specs against a local or throwaway instance, never the live site. Specs can register users and leave data behind. Confirm the test target and database before running tests that write data.
- **Keep AI advisory.** Deterministic application code decides suggestions, costs, and pantry contents. Models may explain, match names, or answer questions, but must not override authoritative application data or calculations. Every page must remain usable when AI is slow, unavailable, or unsupported by the browser.
- **Protect secrets.** Never commit secrets to the repository. Keys belong in Fly secrets or `mise.local.toml`. Never touch `.claude/`.
- **Label prices and nutrition honestly.** Prices and nutrition are estimates unless verified otherwise. Every reference price must include its source and date. Never describe a reference price as a live supermarket price unless the data is genuinely current and its update mechanism supports that claim.
- **Label previews.** Anything that still shows sample data must use `previewBanner()`. `spec/navigation.test.ts` checks this. When a feature becomes real, remove its sample data.
- **Keep navigation consistent.** Add new navigable sections to `NAV_GROUPS` in `src/views/layout.ts`, which feeds the sidebar, mobile tab bar, and `/more`.
- **Respect the design system.** Tokens live in `public/app.css` under `:root`, with a dark palette using browns and greys. Prefer existing classes and components over introducing near-duplicates. Respect `prefers-reduced-motion`.
- **Treat demo mode as temporary.** `DEMO_MODE` in `src/demo.ts` prefills sign-in with Alice. Before final submission, set it to `false`, delete `spec/demo.test.ts`, and remove demo users from the live database. Do not perform these final-submission steps unless explicitly asked to prepare the final submission.

## 3. Development workflow

### Before changing code

For each bug fix, refinement, or feature:

1. **Understand the task.** Identify the requested outcome and the parts of the application it affects.
2. **Inspect the existing implementation.** Read relevant routes, shared modules, types, database models, migrations, tests, and product documentation. Search for existing implementations before adding a new one.
3. **Reproduce the current behaviour.** When practical, confirm the problem with a test or a reliable sequence of steps. Record what happens now and what should happen instead.
4. **Trace the root cause.** Follow the data and logic through the relevant layers. Determine whether the issue originates in the data model, calculation, persistence, route, integration, or UI. Do not assume the visible symptom is the root cause.
5. **Map dependencies.** Search for other pages and features that use the affected data, function, or rule. Consider recipes, the meal calendar, pantry, shopping list, household features, and budget summaries where relevant.
6. **Check constraints.** Identify which invariants and existing behaviours must be preserved.
7. **Resolve important ambiguity.** Use existing code, tests, and documentation to resolve minor implementation details. Do not silently make significant product decisions involving pricing, budgeting, privacy, data integrity, or security. Explain the alternatives and ask for clarification when the intended behaviour cannot be established.

### While changing code

- Make the smallest complete change that corrects the underlying problem.
- Prefer fixing an existing shared implementation over adding a parallel implementation of the same business rule.
- Avoid unrelated refactors, unnecessary dependencies, and broad rewrites.
- Preserve existing behaviour unless the task or an approved product decision requires changing it.
- Keep business logic deterministic and testable.
- Do not silently replace missing, invalid, stale, or unknown values with plausible-looking defaults.
- Update relevant documentation when a business rule or user-visible behaviour changes.
- Do not edit shipped migrations. Add a new migration when a schema change is required.

### After changing code

1. Add or update regression tests. Where possible, a regression test should fail with the original behaviour and pass with the fix.
2. Test the business rule in isolation where practical, then test its integration with affected features.
3. Run the relevant tests and `pnpm check` against a local or throwaway app instance, never the live site.
4. If a test cannot run, state why. Do not claim that unverified behaviour has been tested.
5. For UI changes, inspect screenshots at 1440 px and 390 px, in light and dark modes. Check interactive behaviour as well as appearance.
6. Review relevant loading, empty, error, and success states.
7. Report the root cause, the changes made, the tests run and their results, and any remaining limitations or assumptions.

Do not claim a bug is fixed merely because the code compiles or the page looks correct. Verify the behaviour that was originally wrong.

## 4. Architecture and business logic

### Shared business rules

- Keep authoritative business rules in shared, testable modules rather than duplicating calculations across routes or UI components.
- Before implementing a calculation or rule, search for existing implementations and determine whether to reuse or correct them.
- UI components should display authoritative results rather than independently reimplementing business calculations.
- When a shared rule changes, identify every dependent feature and verify that it remains consistent.
- Use explicit types, field names, and units to distinguish concepts that may otherwise be confused.
- Keep calculations deterministic. AI and external services may provide inputs or explanations, but must not override authoritative calculations.
- Follow the existing architecture. Example file structures in a prompt or document are suggestions, not permission to create duplicate systems without inspecting the repository first.

### Pricing and budgeting

Pricing is a core business rule. Keep the following concepts distinct:

1. **Ingredient consumption cost:** The estimated value of the quantity used by a recipe or meal.
2. **Recipe ingredient cost:** The sum of the estimated consumption costs of the recipe's ingredients for the specified recipe batch.
3. **Cost per serving:** The relevant recipe ingredient cost divided by the number of servings that the batch produces.
4. **Shopping requirement:** The additional quantity of each ingredient needed after accounting for eligible pantry stock and all relevant planned meals.
5. **Package purchase requirement:** The number and type of purchasable packages needed to satisfy the remaining shopping requirement.
6. **Shopping expenditure:** The estimated amount the user must pay to purchase those packages, using the available package prices.
7. **Budget total:** The cost measure selected for that budget feature. Label it clearly and do not mix consumption cost and package purchase expenditure without explaining the distinction.

Rules:

- Do not present ingredient consumption cost or cost per serving as if it were the amount the user must spend at the supermarket.
- Calculate consumption cost from the recipe quantity used and the price of a compatible reference quantity or package.
- Calculate recipe cost from its ingredient consumption costs. Calculate cost per serving from the appropriate recipe batch cost and batch yield.
- Calculate shopping requirements by aggregating ingredient needs across the relevant planned meals, then subtracting eligible personal or household pantry stock according to the feature's rules.
- Determine package purchases from the remaining quantity, package sizes, available purchasing options, and package prices. Where purchases must be made in whole packages, round up to the required number of packages.
- Do not calculate each meal's package purchases independently if doing so would overstate purchases when ingredients can be shared across meals.
- Distinguish the cost of consuming part of a package from the expenditure required to buy a package.
- Use compatible units. Do not convert between mass, volume, and count unless a valid ingredient-specific conversion is available.
- Handle recipe yield, planned servings, package quantity, pantry quantity, and purchase quantity as distinct values with explicit units.
- Changing the planned serving count should update ingredient requirements and related costs consistently. Do not confuse the cost of a fixed recipe batch with the cost of serving a different number of people.
- If a package size, conversion, or price is unknown, do not invent one or silently treat the ingredient as free. Show an unavailable value or a clearly labelled estimate, as appropriate.
- Clearly distinguish verified current prices, dated reference prices, historical prices, and estimates. Preserve each reference price's source and date.
- Make budget calculations use a clearly defined cost measure. Do not compare a consumption-cost estimate against a spending limit that represents checkout expenditure without clearly accounting for the difference.
- Keep price calculations deterministic. AI may explain a result but must not determine or override the price.
- When changing pricing logic, inspect every dependent feature, including recipe pages, meal planning, calendar views, shopping lists, pantry calculations, household shopping, and budget summaries where applicable.

Detailed pricing examples and additional domain rules should live in a focused product specification, such as `docs/product/pricing.md`, if that document exists or is created for the task. Keep the specification aligned with the implementation and tests.

### Data quality and external services

- Keep the application useful when optional external services are unavailable.
- Do not claim that a price, recipe, image, or other external data is current unless the source and update process justify that claim.
- Preserve source and date information for reference pricing.
- Handle stale, missing, or failed external data explicitly. Do not invent data to make a feature appear complete.
- Respect applicable source terms and access restrictions when integrating external data.
- Prefer graceful fallbacks that explain uncertainty while preserving unrelated functionality.

## 5. Product principles

### Complete user workflows

The website should feel like a complete product, not a collection of disconnected feature previews.

- Each major feature should explain what it does and provide an obvious next step for the user's likely task.
- Users should not need to search unrelated pages to discover the next interaction for a feature they are already using.
- Related workflows should share data consistently. For example, changing a planned meal should update the relevant shopping requirements.
- Provide useful loading, empty, error, and success states.
- Remove sample data when a feature becomes real, and ensure remaining previews are labelled with `previewBanner()`.

### Anonymous access and privacy

- Public inspiration and discovery should be available to anonymous visitors when the data is explicitly public and the action does not require an account.
- Anonymous visitors may browse eligible public live-cooking sessions without creating an account or signing in.
- Actions that require an identified user, such as private interactions or account-specific changes, must ask the visitor to sign in.
- Never expose private recipes, pantry data, household details, private sessions, or other restricted information through public pages, APIs, search results, or live updates.
- Use `src/visibility.ts` for visibility decisions. Inaccessible resources return 404, never 403.
- Respect users' location-sharing and visibility choices. Do not invent or expose a location when it is unavailable or not shared.
- Public features must remain useful without requiring users to access private or account-only features.

### Resilience and accessibility

- Core functionality must remain usable when optional AI, external data sources, live updates, or 3D rendering are unavailable.
- Provide accessible alternatives for interactions that rely on 3D, hover, dragging, or animation.
- Ensure keyboard users can access important actions and information.
- Respect `prefers-reduced-motion`.
- Avoid making essential information available only through animation, colour, hover, or a visual model.
- Treat missing, invalid, or unavailable data explicitly rather than silently fabricating values.

## 6. Design principles

### Visual direction

The intended aesthetic is clean, calm, premium, and welcoming: light pastel colours, generous negative space, rounded edges, clear typography, restrained shadows, and consistent spacing. Dark mode should use a considered palette of browns and greys.

Use Apple and Pinterest as broad visual inspiration, not as a reason to copy a specific page or add unnecessary decoration.

- Reuse the existing design tokens, components, and CSS classes wherever possible.
- Keep typography, spacing, radii, colours, and shadows consistent across pages.
- Prioritise information hierarchy, readability, and usability over decorative effects.
- Use real recipe imagery where the application has suitable, appropriately sourced images. Do not fabricate claims about image sources.
- Use skeleton or loading states where they improve the perceived responsiveness of content-heavy views.
- Ensure that responsive layouts remain clear and usable at both desktop and mobile sizes.
- Use 3D models and animation when they improve the experience, but do not let them obscure data or block essential tasks.

### UI verification

For meaningful UI changes:

- Take and inspect screenshots at 1440 px and 390 px.
- Check light and dark modes.
- Verify the actual interaction, not just the screenshot.
- Check loading, empty, error, and success states where relevant.
- Check text legibility, focus states, keyboard interaction, and reduced-motion behaviour.
- Confirm that displayed data comes from the correct application source rather than hard-coded sample values, unless the page is explicitly a preview.
- If screenshots or browser testing cannot be performed, state that limitation clearly.

### 3D fridge and pantry

The fridge and pantry are visual representations of the user's real ingredient data, not independent sources of truth.

- Ingredient quantities, units, expiry dates, prices, and meal associations must come from the application's data model.
- Selecting an ingredient should reveal relevant details and available actions without hiding essential context.
- Hover effects must have an accessible alternative for touch and keyboard users.
- Keep essential ingredient information and actions available if 3D rendering fails or is unsuitable for the device.
- Avoid making 3D loading a prerequisite for accessing or updating pantry data.
- Keep transitions smooth and restrained, and respect reduced-motion preferences.

## 7. Feature expectations

These are product goals. Before changing a feature, inspect its current implementation and tests, then identify which of these expectations apply to the task.

### Accounts and friends

- Support registration, login, logout, and persistent sessions.
- Support sending, accepting, and rejecting friend requests, plus a friends list.
- Apply privacy and visibility rules consistently to friend-related data.

### Recipes and cooking

- Support creating, editing, and deleting recipes, including ingredients, steps, dietary tags, and public, friends-only, or private visibility.
- Provide a consistent recipe interface for browsing and cooking.
- Cooking mode should present one step at a time and support relevant timers and serving information.
- A recipe being cooked should use the application's recipe data so its ingredients, nutrition estimates, and costs can be calculated consistently.
- If users need to cook a recipe that is not in the database, support creating a recipe where that capability exists. Do not claim automatic nutrition or pricing is accurate when required data is missing.

### Pantry and expiry

- Support personal pantry ingredients with quantity, unit, expiry date, and price paid.
- Support shared pantry functionality for households.
- Use pantry stock consistently when calculating missing shopping requirements.
- Support relevant expiry reminders, use-soon suggestions, and meal associations without inventing quantities or expiry dates.

### Calendar and meal planning

- Support planning recipes on dates and marking meals as planned or completed.
- Support sharing relevant calendar information with friends or household members according to visibility rules.
- Support quick recipe additions and meal-plan suggestions where implemented.
- Meal-planning preferences may include a weekly budget, variety, limiting meat, usual meals, trying new meals, seasonal ingredients, and available pantry ingredients.
- Use the appropriate pricing and pantry rules when generating suggestions or shopping requirements.
- Changing or removing planned meals must update dependent information consistently.

### Shopping lists and household

- Build shopping requirements from relevant planned meals and subtract eligible pantry stock.
- Aggregate ingredient requirements before calculating package purchases.
- Distinguish estimated consumption cost from estimated shopping expenditure.
- Support checking off shopping items and the relevant weekly budget.
- Where shared shopping is implemented, support claiming and unclaiming items and displaying shared budget information consistently.
- Household membership and shared data must respect visibility and authorisation rules.

### Live cooking and global discovery

- Support the recipe's live cooking state and relevant step progress where implemented.
- Highlight friends before other public sessions for signed-in users.
- Allow anonymous visitors to explore public sessions without signing in.
- Present useful session information, such as the recipe and current step, within the discovery experience where available.
- When multiple cooks are near each other on the globe, it is acceptable to group activity visually, but users must be able to inspect individual sessions.
- Do not expose private session details or unshared location information.
- Handle unavailable live data gracefully and make clear when information cannot be refreshed.

### Recipe catalogue and external pricing

- Aim for a useful, well-organised catalogue of recipes and ingredients.
- Treat catalogue size as a product goal, not permission to fabricate recipes, images, prices, or nutrition data.
- Preserve provenance for imported or reference data where applicable.
- Integrate supermarket prices only through sources and methods that are actually available and appropriate.
- Distinguish current verified prices from dated references and estimates.
- If current pricing cannot be retrieved, provide a clear fallback rather than presenting stale data as live.

## 8. Testing and acceptance criteria

- Every new invariant requires a spec test in `spec/`.
- Add regression coverage for bugs, especially when shared business logic is involved.
- Use focused unit tests for deterministic calculations where practical, integration tests for interactions between modules, and HTTP specs for important end-to-end application behaviour.
- Test normal cases, boundary cases, missing data, invalid inputs, and relevant failure conditions.
- For cross-feature changes, test the originating action and the affected dependent views.
- For pricing changes, consider package rounding, compatible units, pantry stock, aggregated meal requirements, serving changes, unavailable prices, and consistency between recipe costs and shopping expenditure.
- Run `pnpm check` against a local or throwaway app instance, never the live site.
- Do not edit or delete `spec/invariants.test.ts`.
- If a test fails, investigate whether the failure indicates a regression, an incorrect assumption, or an existing issue. Do not weaken or delete a test merely to make the suite pass.
- Do not report tests as passing unless they were actually run and passed.

## 9. Development commands

- `pnpm dev` — runs the app at `http://localhost:8080` using the database in `./data`.
- `pnpm check` — runs typechecking and every spec against the running app.
- `pnpm check:evidence` — processes assessment evidence, including `CLAUDE.md`, reflections, and `PROCESS.md`.

Before running commands that may write data, confirm the app and database target. Never run the specs against the live site.

## 10. Completion report

When completing a non-trivial task, report:

- **Root cause:** What was wrong and why.
- **Changes:** What was changed and why this approach was chosen.
- **Affected features:** Which related parts of the application were checked.
- **Verification:** Which tests and checks were run, with their actual results.
- **Limitations:** Anything not verified, remaining uncertainty, or product decisions still required.

Keep the report concise but specific. Do not claim complete verification when some checks could not be performed.