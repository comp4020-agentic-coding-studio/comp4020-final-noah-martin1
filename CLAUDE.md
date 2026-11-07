# FOCUS MODE, COMPLETE THE FOLLOWING TASKS:

## TASK 1, IMPROVE VISUAL GUIDANCE FOR SACNNING IMAGES FOR INGREDIENT ADDITIONS

## 1. Active Task Intent
- **Goal:** Currently when a user wants to scan an image to either process an image of their fridge, pantry (or larder), reciept, or barcode, they are presented with a screen that simply says, "Scan on this device" and below it: a button that says "choose image". Which is very uninspiring and doesnt give direction for what they should take a photo of (what the webpage expects). The goal is to provide visually inspiring visual direction with 3d modelling to improve this.
   
- **Features to achieve / implement:**
- for each scanning option create a 3d animation that loops and provides text for what the user should do. Im thinking the perspective from the users shoulder where the user aims their phone at the fridge and you can see the fridge or pantry in the phone camera screen, then they click the take photo button. - demonstrating that theyre taking a photo of their fridge as a whole
- For the recipe I want it to follow the same vibe, have the animation of the shoulder pov, a user with their arm extended holding their camera above a reciept on a bench and taking a photo.
- For the barcode - again same style - shoulder pov, user extending arm, flippimng over a ceral box and taking a photo of the barcode on the back.


- **Things to explore** 

1. I want these animations/ models to look the same quality and theme as the fridge and pantry. High quality modelling with smooth movement. I want the animation to be looped but not too short or the looping animation will put off the user. Try to make the direction as simple as possible and understandable so that no instruction text is needed.
   
- **Credit Allocation:** This task involves modelling and testing which needs to be done right and with careful consideration to be functional - allocate $90

- **Double-Check Rule:** FOR EACH ANIMATION DOUBLE CHECK THE MODEL IS CONSISTENT AND IS NOT BUGGED - I dont want clipping or floating objects - find a real life reference animation / video if you have to compare. Screenshot and analyse each one.

## 2. Active Technical Constraints
- **AI Advisory Invariant:** Keep code updates deterministic. Models may map names or parse transcript text, but application logic remains the source of truth.
- **Verification Command:** Run `pnpm check` and your recipe test specs locally to ensure nothing is broken after an iteration.

## 3. Project References
- For long-term non-negotiable rules, full git/testing workflows, layout styles, and HTML escaping instructions, refer to `@ARCHITECTURAL_GUIDELINES.md`. Ignore them during transcript extraction unless actively modifying code infrastructure.



# BELOW IS COMMENTED OUT OLD TASKS, PLEASE IGNORE:

 <!--## TASK 1, IMPROVE AND CREATE MORE 3D MODELS FOR ITEMS IN FRIDGE/PANTRY

## 1. Active Task Intent
- **Goal:** Find the most common ingredients used in the recipes, you dont have to add 3d models for all of them, but all of the common ones. If its a rare item I can expect it to be categorised as a simialr 3d model. 
   
- **Features to achieve / implement:**
- Go through each current ingredient in the system and find a referenced image / model and create a model for this ingredient. If its a rare ingredient its ok to reuse a 3d model of a similar product - to reduce overhead.
- Check that each model fits in the fridge / pantry correctly that is: the size is appropriate and it doesnt clip through other objects / hides or is hidden by other objects.
- check that the 3d model actually looks like the ingredient.
- check that I can actually click on the model in the fridge and it behaves as it should.

- **Things to explore** 

1. Some items can resued 3D models of similar items but check that the items are actually similar. For example: peanut butter is using a 3d model of a stick of butter when it should be a jar with a peanut icon on the front.
   
- **Credit Allocation:** This task involves modelling and testing which needs to be done right and with careful consideration to be functional - allocate $90

- **Double-Check Rule:** WE WANT ITEMS TO BE DISTINGUISABLE FROM THEIR 3D MODEL - This is the whole point of this data representation - if you dont know what it is by a screenshot of the fridge/ pantry screen make it more recognisable. Do this: test it by screenshotting the fridge and checking what you see with what is actually there.

## 2. Active Technical Constraints
- **Database Rules:** Avoid duplicate models, if separate ingeredients share a indistinguishable model, remove one.
- **AI Advisory Invariant:** Keep code updates deterministic. Models may map names or parse transcript text, but application logic remains the source of truth.
- **Verification Command:** Run `pnpm check` and your recipe test specs locally to ensure nothing is broken after an iteration.

## 3. Project References
- For long-term non-negotiable rules, full git/testing workflows, layout styles, and HTML escaping instructions, refer to `@ARCHITECTURAL_GUIDELINES.md`. Ignore them during transcript extraction unless actively modifying code infrastructure.



## ITERATE OVER THIS TASK UNITL COMPLETE

## TASK 1, CHECK INGREDIENT DATABASE TO FIX MEAL PLANNING

## 1. Active Task Intent
- **Goal:** Have as many ingredients as possible linked to a price from either Aldi woolworths or coles. Currently meal suggestions are suggesting "cheap" meals - not because they are cheap but because some ingredients are missing from the total price causing the price to be significantly lower than what it should be. For example Tavë Kosi Baked Lamb and Yogurt - doesnt have the price for lamb shoulder which is ~ $30 from woolworths and is saying total cost of meal is $5.50 at checkout.
   
- **Features to achieve / implement:**
- Go through each current ingredient in the system and find a referenced price from either woolworths coles or aldi. IF uable to find the exact item find something similar - mention this on the recipe.
- Make sure the "ingredients used" and "recipe uses" are either better defined or renamed to avoid confusion. curreltly they are different prices and I dont know why.
- assume water is always avaliable - some recipes call for water and it says water is missing from my ingredients.
- Since we are building a database of pricing, when someone is creating a recipe and they are using an ingredient that larder doesnt know the price of - prompt the author to provide a price. For every other item that we have on the database - mention its price and allow it to be corrected by the user.

- **Things to explore** 

1. Following along with this topic, I cant see a "search by what you have" filter on the recipe page. - it says "Search by dish or by what's already in the fridge." but i cant see how to seach by what i have. Fix that. - include receipes that are missing 1 or 2 ingredients - however provide them last.

- **Credit Allocation:** This task implements multiple features that need careful consideration and testing to be functional - allocate $60

- **Double-Check Rule:** check every ingredient item for its reference on one of the large supermarket chains. If it doesnt exist (they dont sell it) and a reasonable similar item doesnt exist, find a price online and provide it as an estimate. For example a niche asian supermarket item.

## 2. Active Technical Constraints
- **Database Rules:** Avoid duplicate pricing for items - this means items that are the same thing but under different names (unless they are different products - have different wepages on the same supermarket platform). This is something that needs to be checked before added to the database.
- **AI Advisory Invariant:** Keep code updates deterministic. Models may map names or parse transcript text, but application logic remains the source of truth.
- **Verification Command:** Run `pnpm check` and your recipe test specs locally to ensure nothing is broken after an iteration.

## 3. Project References
- For long-term non-negotiable rules, full git/testing workflows, layout styles, and HTML escaping instructions, refer to `@ARCHITECTURAL_GUIDELINES.md`. Ignore them during transcript extraction unless actively modifying code infrastructure.




## TASK 1, INTEGRATE REVIEWS INTO RECIPES.

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


 ## TASK 1, REAL LIFE FRIDGE/PANTRY IMAGE CATEGORISING AND PROCESSING TO VIRTUAL FRIDGE/PANTRY

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
