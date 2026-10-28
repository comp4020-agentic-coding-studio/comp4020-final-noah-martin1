# FOCUS MODE: ITERATIVE RECIPE VIDEO MATCHING & TRANSCRIPT PARSING

## 1. Active Task Intent
- **Goal:** Find videos matching existing recipes, extract/watch transcripts, and align the steps/ingredients *exactly* with the video.
- **Credit Allocation:** This is a high-intensity iterative task. You MUST execute loops and use up to $160 worth of credits on this assignment. 
- If current recipes are completely matched and credit remains, find *new* high-quality YouTube cooking videos, extract their transcripts, translate them into structured recipes/ingredients, and add them to the database.
- **Double-Check Rule:** It is an absolute MUST that each individual video matching is double-checked for correctness before finalising. Correctness means each step outlined in the web-app is algined with the video as well as the ingredients. This is also synced with the "live cooking intructions". Furthermore each ingredient is found in a major australian grocery store - ALDI, COLES, WOOLWORTHS etc for pricing - and this pricing is accurate and appropriate - run an agent to check this logic - for example; 2 hand-fulls of coriander doesn't mean 2 bunches. These kinds of quantity checks need to be made.

## 2. Active Technical Constraints
- **Database Rules:** When writing new recipes or altering ingredients to match videos, use standard project schema patterns. If a schema change is needed, add a new numbered migration to `src/migrations/`. Do NOT edit migrations 001–003.
- **AI Advisory Invariant:** Keep code updates deterministic. Models may map names or parse transcript text, but application logic remains the source of truth.
- **Verification Command:** Run `pnpm check` and your recipe test specs locally to ensure nothing is broken after an iteration.

## 3. Logging learning achievements
- To improve future sessions dealing with these task write down useful notes the agents can use next time in AI_NOTES.md under docs. These notes must be actually useful and meaningful - DO NOT ADD TO IT IF NOT NEEDED. There is no need to fill this markdown file - its purpose is to hold usefull information that you had to learn to better complete this task. - organise accordingly.

## 3. Project References
- For long-term non-negotiable rules, full git/testing workflows, layout styles, and HTML escaping instructions, refer to `@ARCHITECTURAL_GUIDELINES.md`. Ignore them during transcript extraction unless actively modifying code infrastructure.
