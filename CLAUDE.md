# FOCUS MODE, COMPLETE THE FOLLOWING TASKS:

 ## TASK 1, REAL LIFE FRIDGE/PANTRY IMAGE CATEGORISING AND PROCESSING TO VIRTUAL FRIDGE/PANTRY

## 1. Active Task Intent
- **Goal:** Create and integrate a review feature for the web app. Users should be able to write reviews and their presence remains persistent on the web app's recipe. Users can write reviews for reciepes which can then be liked and replied to by other users. As users are actively writing comments this should be seen by others as 3 animated dots. 
   
- **Features to achieve / implement:**
- A review / comment window within recipe pages, formatted correctly toward the bottom of the screen. rearranging of items is allowed to make the workflow right - ill check this.
- reviews should have a like and reply feature - behaving as a comment - to make more social.
- reviews should be allowed to add images
- reviews should have a process for sharing / referencing other recipes
- poeple actively writing reviews should be visible to others indicated by 3 animated dots.
- reviews have built in translaters

- **Things to explore** 

1. Reviews that poeple write should post the authors name and profile image. explore pre-generated fun animated cooking related profile images - similar to the netflix profile images.
   
2. reviews have a x/5 star rating system and provide an average at the top

3. Sort by reviews: filter reviews by either has image or language or date etc..

- **Credit Allocation:** This task implements multiple features that need careful consideration and testing to be functional - allocate $60

- **Double-Check Rule:** There are many small features/details for this these main feature to work, test each one independently in different contexts to ensure functionality.

## 2. Active Technical Constraints
- **Database Rules:** keep reviews and comments / replies persistent and connected to the user so that if the user account is deleted there comment remains but profile image and name is removed.
- **AI Advisory Invariant:** Keep code updates deterministic. Models may map names or parse transcript text, but application logic remains the source of truth.
- **Verification Command:** Run `pnpm check` and your recipe test specs locally to ensure nothing is broken after an iteration.

## 3. Project References
- For long-term non-negotiable rules, full git/testing workflows, layout styles, and HTML escaping instructions, refer to `@ARCHITECTURAL_GUIDELINES.md`. Ignore them during transcript extraction unless actively modifying code infrastructure.


# BELOW IS COMMENTED OUT OLD TASKS, PLEASE IGNORE:
<!-- ## TASK 1, REAL LIFE FRIDGE/PANTRY IMAGE CATEGORISING AND PROCESSING TO VIRTUAL FRIDGE/PANTRY

## 1. Active Task Intent
- **Goal:** Evaluate, select, and integrate the highest-performing **locally hostable Vision-Language Model (VLM) or Object Detection framework** capable of parsing real-life fridge and pantry images. The objective is to maximise automated item identification and classification while minimising friction during the virtual inventory "add item" workflow.
   
- **Features to achieve / implement:**
- real life pantry/fridge photo to web app items
- barcode scanner for individual items to add as web app item
- reciept reader to add items on reciept to web app.

- **Things to explore** 

1. Performance. Perfomance is key for these features to work. There are two main metrics that should be considered; speed and correctness. These need to be tested with findings reported to the results.md under the "testing" directory. I want each of these 3 features to be tested and have results found there.
   
2. Even if the machine learning programs aren't incredibly fast, that doesnt mean the user experience has to be bad; make sure the UI and app run perfectly fine while processing occurs - try having the processing happen in real-time while the camera app is open if possible. For example: tp scan reciepts or barcodes - it automatically takes a picture if the view finder is over a barcode or receipt and it reads it - similar to QR code behaviour. I want the UI and user experience to be the HIGHEST priority

3. Since the photos of fridge/pantry cant provide information on how much the item cost or when its expiry is, use our collected data to pre fill these parameters. We use woolworths and aldi pricing for reciepe ingredients so we can use this as a guess for the automated photo-to-item tool. AGAIN MAKE USER EXPERIENCE AS SMOOTH AS CAN BE. If there are other ways like the example above that can make this process better by reducing user work - implement.

- **Credit Allocation:** This task needs to be tested to ensure its genuine usefullness. Machione klearning often makes false promises so tests and looking for the vbest / largest models is where the foucs is. Allocation: $80

- **Double-Check Rule:** Part of this task is dependent on how well the model performs. For example if the algorithim can only distinguish between item identifcation - its needs to have the framework for a user to complete whats missing - following the example would be user adds expiration and quantitiy. Test with real life images of fridges. Add the image to a file in the "testing" directory and add what you thought was in the fridge, what the model thought was in the fridge and ill double check this.

## 2. Active Technical Constraints
- **Database Rules:** If the model defines an ingredient as something that doesnt exist in the database already - make sure it isnt a different spelling or a different name before proceeding
- **AI Advisory Invariant:** Keep code updates deterministic. Models may map names or parse transcript text, but application logic remains the source of truth.
- **Verification Command:** Run `pnpm check` and your recipe test specs locally to ensure nothing is broken after an iteration.

## 3. Logging learning achievements
- To improve future sessions dealing with these tasks, create a file and write down useful notes the agents can use next time in AI_NOTES.md under testing. These notes must be actually useful and meaningful - DO NOT ADD TO IT IF NOT NEEDED. There is no need to fill this markdown file - its purpose is to hold usefull information that you had to learn to better complete this task. - organise accordingly.

## 3. Project References
- For long-term non-negotiable rules, full git/testing workflows, layout styles, and HTML escaping instructions, refer to `@ARCHITECTURAL_GUIDELINES.md`. Ignore them during transcript extraction unless actively modifying code infrastructure.

## TASK 2, ITERATIVE RECIPE VIDEO MATCHING & TRANSCRIPT PARSING

continue this task until out of credit (assuming task 1 is complete)

## 1. Active Task Intent
- **Goal:** Find videos matching existing recipes, extract/watch transcripts, and align the steps/ingredients *exactly* with the video.
- **Credit Allocation:** This is a high-intensity iterative task. You MUST execute loops and use up ALL of the remanining credit. This is becuase I expect TASK 1 to have already been completed and use the rest of the budget adding more reciepes (TASK 2) - DO NOT STOP UNTIL OUT OF CREDIT. 
- If current recipes are completely matched and credit remains, find *new* high-quality YouTube cooking videos, extract their transcripts, translate them into structured recipes/ingredients, and add them to the database.
- When gathering youtube transcripts make sure to not fetch too many too quickly - to prevent youtube blocking this IP address. Take your time. And if IP blocked try a different approach.
- **Double-Check Rule:** It is an absolute MUST that each individual video matching is double-checked for correctness before finalising. Correctness means each step outlined in the web-app is algined with the video as well as the ingredients. This is also synced with the "live cooking intructions". Furthermore each ingredient is found in a major australian grocery store - ALDI, COLES, WOOLWORTHS etc for pricing - and this pricing is accurate and appropriate - run an agent to check this logic - for example; 2 hand-fulls of coriander doesn't mean 2 bunches. These kinds of quantity checks need to be made.

## 2. Active Technical Constraints
- **Database Rules:** When writing new recipes or altering ingredients to match videos, use standard project schema patterns. If a schema change is needed, add a new numbered migration to `src/migrations/`. Do NOT edit migrations 001–003.
- **AI Advisory Invariant:** Keep code updates deterministic. Models may map names or parse transcript text, but application logic remains the source of truth.
- **Verification Command:** Run `pnpm check` and your recipe test specs locally to ensure nothing is broken after an iteration.

## 3. Logging learning achievements
- To improve future sessions dealing with these task write down useful notes the agents can use next time in AI_NOTES.md under docs. These notes must be actually useful and meaningful - DO NOT ADD TO IT IF NOT NEEDED. There is no need to fill this markdown file - its purpose is to hold usefull information that you had to learn to better complete this task. - organise accordingly.

## 3. Project References
- For long-term non-negotiable rules, full git/testing workflows, layout styles, and HTML escaping instructions, refer to `@ARCHITECTURAL_GUIDELINES.md`. Ignore them during transcript extraction unless actively modifying code infrastructure. 
 -->
