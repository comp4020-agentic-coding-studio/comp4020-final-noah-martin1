import { catalogFor } from "../db.ts";
import { DIETARY_TAGS, money, qty, today } from "../format.ts";
import { type Html, html, raw } from "../html.ts";
import { type Ctx, HttpError, htmlReply, redirect, setFlash } from "../http.ts";
import {
  deleteRecipe,
  getRecipe,
  listVisibleRecipes,
  pantryMatch,
  parseRecipeForm,
  type Recipe,
  type RecipeInput,
  recipeIngredients,
  recipeSteps,
  saveRecipe,
} from "../recipes.ts";
import { prefsFor } from "../prefs.ts";
import type { Route } from "../server.ts";
import { canSeeRecipe } from "../visibility.ts";
import { avatar, empty, errors, icon, page, pageHeader } from "../views/layout.ts";

const VISIBILITY_LABEL = { public: "Public", friends: "Friends", private: "Only me" } as const;

export function visibilityBadge(v: Recipe["visibility"]): Html {
  return html`<span class="badge badge-${v}">${VISIBILITY_LABEL[v]}</span>`;
}

export function recipeCard(r: Recipe, showAuthor = true): Html {
  return html`<article class="card recipe-card">
    <div class="card-top">
      ${visibilityBadge(r.visibility)}
      <span class="muted mono">${r.servings} serves</span>
    </div>
    <h3><a class="stretched" href="/recipes/${r.id}">${r.title}</a></h3>
    ${r.description ? html`<p class="clamp">${r.description}</p>` : ""}
    <div class="tags">${r.dietary_tags.map((t) => html`<span class="tag">${t}</span>`)}</div>
    <footer class="card-foot">
      ${showAuthor ? html`<span class="byline">${avatar(r.author_name, "sm")} ${r.author_name}</span>` : html`<span></span>`}
      <span class="muted mono">${r.ingredient_count} ingr · ${r.step_count} steps</span>
    </footer>
  </article>`;
}

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "There's no recipe at this address.");
  return id;
}

// The recipe if the viewer may see it; otherwise 404, never 403, so a stranger
// can't learn that a private recipe exists.
export function visibleRecipe(ctx: Ctx): Recipe {
  const recipe = getRecipe(parseId(ctx));
  if (!recipe || !canSeeRecipe(ctx.user?.id ?? null, recipe)) {
    throw new HttpError(404, "There's no recipe at this address.");
  }
  return recipe;
}

function ownRecipe(ctx: Ctx): Recipe {
  const recipe = visibleRecipe(ctx);
  if (recipe.author_id !== ctx.user!.id) throw new HttpError(403, "Only the author can change this recipe.");
  return recipe;
}

function ingredientRow(i: number, ing?: RecipeInput["ingredients"][number]): Html {
  return html`<div class="row-editor" data-row>
    <input name="ing_qty" inputmode="decimal" placeholder="Qty" aria-label="Quantity" value="${ing?.quantity ?? ""}" class="w-qty" />
    <input name="ing_unit" placeholder="Unit" aria-label="Unit" value="${ing?.unit ?? ""}" class="w-unit" />
    <input name="ing_name" placeholder="Ingredient" aria-label="Ingredient" list="ingredient-catalog" value="${ing?.name ?? ""}" class="grow" />
    <label class="check-inline" title="Optional ingredient"><input type="checkbox" name="ing_optional" value="${i}" ${ing?.optional ? raw("checked") : ""} /> <span>Optional</span></label>
    <button type="button" class="icon-button" data-remove-row aria-label="Remove ingredient">×</button>
  </div>`;
}

function stepRow(step?: RecipeInput["steps"][number]): Html {
  return html`<div class="row-editor step-editor" data-row>
    <span class="step-num" aria-hidden="true"></span>
    <textarea name="step_text" rows="2" placeholder="Describe this step" aria-label="Step" class="grow">${step?.text ?? ""}</textarea>
    <input name="step_minutes" inputmode="numeric" placeholder="Min" aria-label="Minutes" value="${step?.est_minutes ?? ""}" class="w-qty" />
    <button type="button" class="icon-button" data-remove-row aria-label="Remove step">×</button>
  </div>`;
}

function recipeForm(ctx: Ctx, input: Partial<RecipeInput>, problems: string[], recipeId?: number, status = 200) {
  const ingredients = input.ingredients?.length ? input.ingredients : [undefined, undefined, undefined];
  const steps = input.steps?.length ? input.steps : [undefined, undefined];
  const catalog = catalogFor(ctx.user!.id);
  const prefs = prefsFor(ctx.user!.id);
  const vis = input.visibility ?? prefs.default_visibility;
  const editing = recipeId !== undefined;
  return htmlReply(
    page(ctx, {
      title: editing ? "Edit recipe" : "New recipe",
      active: "recipes",
      body: html`
        ${pageHeader(editing ? "Edit recipe" : "New recipe", "Ingredients link to your pantry, so use the names you stock.")}
        ${errors(problems)}
        <form method="post" action="${editing ? `/recipes/${recipeId}/edit` : "/recipes/new"}" class="form-grid">
          <section class="panel stack">
            <h2 class="panel-title">Basics</h2>
            <label class="field"><span>Title</span>
              <input name="title" required maxlength="120" value="${input.title ?? ""}" /></label>
            <label class="field"><span>Description</span>
              <textarea name="description" rows="3" maxlength="2000">${input.description ?? ""}</textarea></label>
            <div class="field-row">
              <label class="field"><span>Serves</span>
                <input name="servings" type="number" min="1" max="50" required value="${input.servings ?? prefs.default_servings}" /></label>
              <fieldset class="field">
                <legend>Who can see it</legend>
                <div class="segmented">
                  ${(["public", "friends", "private"] as const).map(
                    (v) => html`<label><input type="radio" name="visibility" value="${v}" ${v === vis ? raw("checked") : ""} /><span>${VISIBILITY_LABEL[v]}</span></label>`,
                  )}
                </div>
              </fieldset>
            </div>
            <fieldset class="field">
              <legend>Dietary tags</legend>
              <div class="chips">
                ${DIETARY_TAGS.map(
                  (t) => html`<label class="chip"><input type="checkbox" name="tags" value="${t}" ${input.dietary_tags?.includes(t) ? raw("checked") : ""} /><span>${t}</span></label>`,
                )}
              </div>
            </fieldset>
          </section>

          <section class="panel stack">
            <h2 class="panel-title">Ingredients</h2>
            <div class="rows" data-rows="ingredients">
              ${ingredients.map((ing, i) => ingredientRow(i, ing))}
            </div>
            <template data-template="ingredients">${ingredientRow(0)}</template>
            <button type="button" class="button button-ghost" data-add-row="ingredients">${icon("plus", 16)} Add ingredient</button>
            <datalist id="ingredient-catalog">${catalog.map((c) => html`<option value="${c}"></option>`)}</datalist>
          </section>

          <section class="panel stack">
            <h2 class="panel-title">Method</h2>
            <div class="rows steps-rows" data-rows="steps">${steps.map((s) => stepRow(s))}</div>
            <template data-template="steps">${stepRow()}</template>
            <button type="button" class="button button-ghost" data-add-row="steps">${icon("plus", 16)} Add step</button>
          </section>

          <div class="form-actions">
            <a class="button button-ghost" href="${editing ? `/recipes/${recipeId}` : "/recipes"}">Cancel</a>
            <button class="button" type="submit">${editing ? "Save changes" : "Publish recipe"}</button>
          </div>
        </form>`,
    }),
    status,
  );
}

function recipeDetail(ctx: Ctx, recipe: Recipe): Html {
  const ingredients = recipeIngredients(recipe.id);
  const steps = recipeSteps(recipe.id);
  const viewer = ctx.user;
  const match = viewer ? pantryMatch(viewer.id, ingredients) : null;
  const mine = viewer?.id === recipe.author_id;
  const totalMinutes = steps.reduce((sum, s) => sum + (s.est_minutes ?? 0), 0);

  return html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/recipes">Recipes</a><span>/</span><span>${recipe.title}</span></nav>
    <header class="page-header recipe-header">
      <div>
        <div class="tags">${visibilityBadge(recipe.visibility)}${recipe.dietary_tags.map((t) => html`<span class="tag">${t}</span>`)}</div>
        <h1>${recipe.title}</h1>
        ${recipe.description ? html`<p class="lede">${recipe.description}</p>` : ""}
        <p class="byline">${avatar(recipe.author_name, "sm")} <a href="/u/${recipe.author_username}">${recipe.author_name}</a></p>
      </div>
      ${mine
        ? html`<div class="page-actions">
            <a class="button button-ghost" href="/recipes/${recipe.id}/edit">Edit</a>
            <form method="post" action="/recipes/${recipe.id}/delete" data-confirm="Delete this recipe? Planned meals using it are removed too.">
              <button class="button button-danger" type="submit">Delete</button>
            </form>
          </div>`
        : ""}
    </header>

    <dl class="stats">
      <div><dt>Serves</dt><dd>${recipe.servings}</dd></div>
      <div><dt>Ingredients</dt><dd>${ingredients.length}</dd></div>
      <div><dt>Time</dt><dd>${totalMinutes ? `${totalMinutes} min` : "—"}</dd></div>
      ${match
        ? html`<div><dt>You're missing</dt><dd>${match.missing}</dd></div>
            <div><dt>Est. to buy</dt><dd>${match.missing === 0 ? "$0.00" : match.priced ? money(match.estCents) : "—"}${match.priced && match.priced < match.missing ? html`<small> (${match.priced}/${match.missing} priced)</small>` : ""}</dd></div>`
        : ""}
    </dl>

    <div class="recipe-layout">
      <section class="panel">
        <h2 class="panel-title">Ingredients</h2>
        <ul class="ingredient-list">
          ${ingredients.map((ing) => {
            const have = match?.have.has(ing.ingredient_id);
            return html`<li class="${match ? (have ? "have" : ing.optional ? "" : "missing") : ""}">
              <span class="mono qty">${qty(ing.quantity, ing.unit)}</span>
              <span class="grow">${ing.name}${ing.optional ? html` <small class="muted">optional</small>` : ""}</span>
              ${match ? html`<span class="pill ${have ? "pill-fresh" : "pill-none"}">${have ? "In pantry" : "Need"}</span>` : ""}
            </li>`;
          })}
        </ul>
      </section>

      <section class="panel">
        <h2 class="panel-title">Method</h2>
        <ol class="steps">
          ${steps.map(
            (s) => html`<li><span class="step-index mono">${String(s.step_number).padStart(2, "0")}</span>
              <p>${s.text}</p>${s.est_minutes ? html`<span class="muted mono">${s.est_minutes} min</span>` : ""}</li>`,
          )}
        </ol>
      </section>

      ${viewer
        ? html`<aside class="panel side-panel">
            <h2 class="panel-title">Plan it</h2>
            <form method="post" action="/calendar" class="stack">
              <input type="hidden" name="recipe_id" value="${recipe.id}" />
              <input type="hidden" name="return_to" value="/recipes/${recipe.id}" />
              <label class="field"><span>Date</span><input type="date" name="date" required value="${today()}" /></label>
              <label class="field"><span>Meal</span>
                <select name="meal"><option value="dinner">Dinner</option><option value="lunch">Lunch</option><option value="breakfast">Breakfast</option></select></label>
              <label class="check-inline"><input type="checkbox" name="shared" value="1" checked /> <span>Share with friends</span></label>
              <button class="button button-block" type="submit">${icon("calendar", 16)} Add to calendar</button>
            </form>
            <hr />
            <a class="button button-block button-ghost" href="/recipes/${recipe.id}/cook">${icon("cook", 16)} Start cooking</a>
            <p class="hint">Step-by-step cook mode. Going live to friends arrives in crit 9.</p>
          </aside>`
        : ""}
    </div>`;
}

function listPage(ctx: Ctx): Html {
  const user = ctx.user!;
  const tab = ctx.url.searchParams.get("tab") === "discover" ? "discover" : "mine";
  const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const tagParam = ctx.url.searchParams.get("tag") ?? "";
  const tag = (DIETARY_TAGS as readonly string[]).includes(tagParam) ? tagParam : "";
  const recipes =
    tab === "mine"
      ? listVisibleRecipes(user.id, { authorId: user.id, query: q, tag })
      : listVisibleRecipes(user.id, { excludeAuthorId: user.id, query: q, tag });

  const tabLink = (key: string, label: string) =>
    html`<a href="/recipes?tab=${key}" class="tab" ${tab === key ? raw('aria-current="page"') : ""}>${label}</a>`;

  return html`
    ${pageHeader("Recipes", "Your cookbook, plus everything friends and the community share with you.", html`<a class="button" href="/recipes/new">${icon("plus", 16)} New recipe</a>`)}
    <div class="toolbar">
      <nav class="tabs" aria-label="Recipe lists">${tabLink("mine", "My recipes")}${tabLink("discover", "Discover")}</nav>
      <form class="filters" method="get" action="/recipes" role="search">
        <input type="hidden" name="tab" value="${tab}" />
        <input type="search" name="q" placeholder="Search recipes" aria-label="Search recipes" value="${q}" />
        <select name="tag" aria-label="Dietary tag">
          <option value="">Any diet</option>
          ${DIETARY_TAGS.map((t) => html`<option value="${t}" ${t === tag ? raw("selected") : ""}>${t}</option>`)}
        </select>
        <button class="button button-ghost" type="submit">Filter</button>
      </form>
    </div>
    ${recipes.length
      ? html`<div class="grid">${recipes.map((r) => recipeCard(r, tab !== "mine"))}</div>`
      : tab === "mine" && !q && !tag
        ? empty("No recipes yet", "Write down something you cook often — it becomes plannable and shareable.", html`<a class="button" href="/recipes/new">Write your first recipe</a>`)
        : empty("Nothing matches", tab === "discover" ? "Recipes friends share with you, and public ones, show up here." : "Try a different search or tag.")}`;
}

export const routes: Route[] = [
  {
    method: "GET",
    path: "/recipes",
    auth: true,
    handler: (ctx) => htmlReply(page(ctx, { title: "Recipes", active: "recipes", body: listPage(ctx) })),
  },
  {
    method: "GET",
    path: "/recipes/new",
    auth: true,
    handler: (ctx) => recipeForm(ctx, {}, []),
  },
  {
    method: "POST",
    path: "/recipes/new",
    auth: true,
    handler: async (ctx) => {
      const { input, problems } = parseRecipeForm(await ctx.form());
      if (problems.length) return recipeForm(ctx, input, problems, undefined, 422);
      const id = saveRecipe(ctx.user!.id, input);
      setFlash(ctx, "Recipe published.");
      return redirect(`/recipes/${id}`);
    },
  },
  {
    method: "GET",
    path: "/recipes/:id",
    handler: (ctx) => {
      const recipe = visibleRecipe(ctx);
      return htmlReply(page(ctx, { title: recipe.title, active: "recipes", body: recipeDetail(ctx, recipe) }));
    },
  },
  {
    method: "GET",
    path: "/recipes/:id/edit",
    auth: true,
    handler: (ctx) => {
      const recipe = ownRecipe(ctx);
      const input: RecipeInput = {
        ...recipe,
        ingredients: recipeIngredients(recipe.id).map((i) => ({ ...i, optional: !!i.optional })),
        steps: recipeSteps(recipe.id),
      };
      return recipeForm(ctx, input, [], recipe.id);
    },
  },
  {
    method: "POST",
    path: "/recipes/:id/edit",
    auth: true,
    handler: async (ctx) => {
      const recipe = ownRecipe(ctx);
      const { input, problems } = parseRecipeForm(await ctx.form());
      if (problems.length) return recipeForm(ctx, input, problems, recipe.id, 422);
      saveRecipe(ctx.user!.id, input, recipe.id);
      setFlash(ctx, "Recipe saved.");
      return redirect(`/recipes/${recipe.id}`);
    },
  },
  {
    method: "POST",
    path: "/recipes/:id/delete",
    auth: true,
    handler: (ctx) => {
      const recipe = ownRecipe(ctx);
      deleteRecipe(recipe.id, ctx.user!.id);
      setFlash(ctx, `Deleted “${recipe.title}”.`);
      return redirect("/recipes");
    },
  },
];
