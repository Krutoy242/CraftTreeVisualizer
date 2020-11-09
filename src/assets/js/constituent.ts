import { ConstituentVisible, CuentArgs } from './ConstituentBase';
import { LinksHolder, Recipe, RecipeHolder } from './recipes';
import { RecipeLink } from './RecipeLink';
import { UniqueKeys } from './utils';
import { listUU } from './listUU';
import * as _ from 'lodash';

const CRAFTING_TABLE_COST = 50.0


function processingCostFromInputAmount(x: number) {
  x--
  return Math.floor(Math.max(0, Math.pow(1.055, x+100) - Math.pow(1.055, 101) + x*25 + CRAFTING_TABLE_COST/2))
}

let logAmount = 0
function log(...args: any[]) { if(logAmount++ < 1000) console.log(...args)}


interface DiveCallbacks {
  onSelf?: (c:Constituent)=>boolean
  afterDive?: (c: Constituent, link: RecipeLink, deph: number, lh: LinksHolder, listName: (keyof RecipeHolder))=>void
  result?: (c: Constituent)=>void
}


export class Uncraftable extends ConstituentVisible {
  
  complexity    = 0.0
  cost          = 0.0
  usability     = 0.0
  popularity    = 0.0
  outputsAmount = 0
  protected calculated    = false

  public get id() : string { return this.name.id }
  public get nbt() : string { return this.name.nbt }

  constructor(cuentArgs: CuentArgs) {
    super(cuentArgs)
  }

  match(o: this): boolean {
    if(this === o) return true
    return this.name.match(o.name)
  }

}

// class ComputableRecipe extends Recipe {

//   constructor(...args: ConstructorParameters<typeof Recipe>) {
//     super(...args)
//   }

// }

class RecipesInfo {
  main       ?: Recipe
  mainHolder ?: LinksHolder
  private catalystsKeys = new UniqueKeys<string, Constituent>()
  private recipesKeys   = new UniqueKeys<string, Recipe>()
  list                = new Map<Recipe, LinksHolder>()
  isLooped = false

  mainInputLinks(): RecipeLink[] {
    return this.mainHolder?.inputs ?? []
  }

  mainCatalistLinks(): RecipeLink[] {
    return this.mainHolder?.catalysts ?? []
  }

  catalystsChain() {return this.catalystsKeys.values()}
  recipesChain() {return this.recipesKeys.values()}

  pickMain(): boolean {
    const typles = [...this.list].filter(([,lh]) => lh.complexity > 0)
    if(typles.length) {
      [[this.main, this.mainHolder]] = typles.sort(([,a],[,b]) => 
        a.complexity - b.complexity
      )

      //************************
      this.recipesKeys.mergeKey(this.main.id, this.main)

      for (const link of this.mainHolder.catalysts) {
        this.catalystsKeys.mergeKey(link.from.id, link.from)
      }

      for (const link of this.mainHolder.inputs) {       
        this.catalystsKeys.mergeChain(link.from.recipes.catalystsKeys)
        this.recipesKeys.mergeChain(link.from.recipes.recipesKeys)
      }
      //************************
      return true
    }
    if(this.list.size > 0) this.isLooped = true
    return false
  }

  pushIfUnique(recipe: Recipe, linksHolder: LinksHolder): boolean {
    if([...this.list.keys()].some(recipe.match)) return false

    this.list.set(recipe, linksHolder)
    return true
  }
  
  iterable() : [Recipe, boolean][] {
    return this.main 
      ? [[this.main, true]] 
      : [...this.list.keys()].map((r,i)=>[r, i===this.list.size-1])
  }

  getLinks(r: Recipe, holderFields: (keyof RecipeHolder)[]): [RecipeLink, (keyof RecipeHolder)][] {
    let holder = this.list.get(r) as LinksHolder
    let arrs = holderFields.map(field => 
      holder[field].map(l=>([l, field] as [RecipeLink, (keyof RecipeHolder)]))
    )
    return _.flatten(arrs)
  }
}

export class Constituent extends Uncraftable {
  processing     = 0.0
  steps          = 0
  noAlternatives = false
  recipes = new RecipesInfo()
  
  outsList: ConstituentStack[] = []
  popList: ConstituentStack[] = []

  
  public get haveRecipes() : boolean {
    return !!this.recipes.list.size
  }
  

  constructor(cuentArgs: CuentArgs) {
    super(cuentArgs)
  }

  // Should be called after all recipes added
  init(): boolean {
    // Check if item spawning naturally
    if (!this.nbt) {
      const predefCost = listUU[this.name.shortand]
      if(predefCost) {
        this.cost = predefCost
        this.processing = 0.0
        this.finishCalc()
        return true
      }
    }
    return false
  }

  finishCalc() {
    //************************
    //* This block would be skipped if cuent have no recipes
    for (const link of this.recipes.mainInputLinks()) {
      link.from.outputsAmount++
      link.from.outsList.push(this.stack(this.recipes.main!.outputs.find(cs=>cs.cuent===this)!.amount))
      this.cost += link.from.cost * link.weight
    }

    for (const link of this.recipes.mainCatalistLinks()) {
      link.from.popularity++
      link.from.popList.push(this.stack())
    }

    for (const recipeInChain of this.recipes.recipesChain()) {
      this.processing = processingCostFromInputAmount(recipeInChain.inputs.length)
      this.steps++
    }

    for (const catalInChain of this.recipes.catalystsChain()) {
      this.processing += catalInChain.complexity ?? 0
    }
    //************************

    this.complexity = this.cost + this.processing
    this.calculated = true
  }

  spawnsNaturally() {
    this.cost = 50.0
  }

  getUUCost(factor: number) {
    return this.cost + this.processing / (factor + Math.sqrt(this.usability || 1))
  }


  // Calculate complexity and other values after all links are created
  calculate() {

    this.safeDive(['catalysts', 'inputs'], {

      onSelf: function(c) {
        if (c.calculated) return true
        c.init()
        return false
      },

      afterDive: function(c, link, deph, lh, listName) {
        if(listName == 'catalysts') {
          lh.addProcessing(link.from.complexity)
        } else {
          lh.addCost(link.from.cost)
        }
      },

      result: function(c) {
        if(!c.calculated) {
          if(!c.recipes.pickMain()) {
            c.spawnsNaturally()
          }
          c.finishCalc()
        }
        log('🔚', c.display);
      },

    })

    return this
  }

  // Recursively iterate through all items in list
  // usually "inputs" or "outputs"
  safeDive(
    listNameArg: (keyof RecipeHolder)[], 
    callbacks: DiveCallbacks, 
    deph = 999999999, 
    refs = {recipes:new Set<Recipe>(), cuents:new Set<Constituent>(), blocked:new Set<Recipe>()}
  ) {
    if (!callbacks.onSelf?.(this) && deph>0 && this.haveRecipes) {
      log('🔸', this.display);
      if(refs.cuents.has(this)) {
        const setList = [...refs.recipes]
        let i = setList.length
        let haveAlts = false
        while (i--) {
          let rec = setList[i]
          haveAlts = haveAlts || rec.haveAlternatives()
          if(rec.hasOutput(this)) break
          if(haveAlts) {
            refs.blocked.delete(rec)
          }
        }
      }
      refs.cuents.add(this)

      //TODO: Pick recipes for 'outputs' list name
      for (const [recipe, isLast] of this.recipes.iterable()) {
        this.noAlternatives ||= isLast

        if(!refs.blocked.has(recipe)) {
          let lh = this.recipes.list.get(recipe) as LinksHolder
          refs.recipes.add(recipe)
          refs.blocked.add(recipe)

          for (const [link, listName] of this.recipes.getLinks(recipe, listNameArg)) {
            //* Recursion 💫
            link.from.safeDive(listNameArg, callbacks, deph-1, refs)
            callbacks.afterDive?.(this, link, deph, lh, listName)
          }

          refs.recipes.delete(recipe)
          refs.blocked.delete(recipe)
        }
      }

      refs.cuents.delete(this)
    }

    return callbacks.result?.(this)
  }


  recalculateField(field: 'cost'|'usability') {
    this[field] = 0
    this.calculated = false
    this.calculate()
  }

  prettyString() {
    return `${this.id} [💱:${this.complexity}] [💲:${this.cost}] ` +
    `♻:${this.usability} [🖩:${this.calculated ? '☑' : '☐'}] [⚙:${this.steps}]`
  }

  stack(amount = 1) : ConstituentStack {
    return new ConstituentStack(this, amount)
  }
}


export class ConstituentStack {
  static sort = (a:ConstituentStack, b:ConstituentStack) => a.cuent.id.localeCompare(b.cuent.id)

  constructor(
    public cuent: Constituent, 
    public amount: number
  ) {

  }

  match(cs: ConstituentStack) { return this.amount === cs.amount && this.cuent.match(cs.cuent)}
}
