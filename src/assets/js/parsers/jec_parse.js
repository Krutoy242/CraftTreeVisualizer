import { clearEmpties } from '../utils'


// ====================================================
// Organize raw Just Enough Calculation json input
// ====================================================
export function parseJECgroups(jec_groups, additionals) {

  // Replace oredict to itemstacks if needed
  function mutateOreToItemstack(raw) {
    if (raw.type === 'oreDict') {
      var oreAlias = additionals[raw.content.name]
      if (!oreAlias) {
        console.log('Cant find OreDict name for:', raw.content.name)
      } else {
        raw.type = 'itemStack'
        raw.content = {
          name: undefined,
          item: oreAlias.item,
          meta: oreAlias.meta
        }
      }
    }
  }


  function prepareEntry(raw, isMutate) {
    if (raw.type === 'empty') return false

    clearEmpties(raw.content.nbt)

    if (isMutate) {
      const nbt = raw.content?.nbt

      // Replace bucket with liquid to actual liquid
      if (raw.content?.item === 'forge:bucketfilled') {
        raw.type = 'fluidStack'
        raw.content = {
          amount: 1000,
          fluid: nbt?.FluidName || '<<Undefined Fluid>>'
        }
      }
    }
    return true
  }

  // Try to remove placeholders that created only to extend ingredient count
  var remIndexes = []
  jec_groups.Default.forEach((jec_recipe, recipe_index) => {

    
    jec_recipe.input = jec_recipe.input.filter(raw => prepareEntry(raw, true))

    var wasRemoved = false
    function replaceInList(craft, listName, phRaw) {
      var pos = craft[listName]
        .map(e => e.content?.name)
        .indexOf(phRaw.content.name)

      if (pos != -1 && craft[listName][pos].type === 'placeholder') {
        craft[listName].splice(pos, 1)
        craft[listName] = craft[listName].concat(jec_recipe.input)
        wasRemoved = true
      }
    }

    // Special case for placeholder in output:
    // Add its all inputs to recipe where it represent input
    var i = jec_recipe.output.length
    while (i--) {
      const raw = jec_recipe.output[i]
      if (!prepareEntry(raw)) { 
        jec_recipe.output.splice(i, 1)
      } else {
        if (raw.type === 'placeholder') {
          jec_groups.Default.forEach(craft => {
            replaceInList(craft, 'input', raw)
            // replaceInList(craft, 'catalyst', raw);
          })
        } else {
          // Replace oredict to itemstacks if needed
          mutateOreToItemstack(raw)
        }
      }
    }
    
    jec_recipe.catalyst = jec_recipe.catalyst.filter(raw => prepareEntry(raw, true))

    if (wasRemoved) {
      remIndexes.push(recipe_index)
    } else {
      jec_recipe.input.forEach(obj_input => {
        // Replace oredict to itemstacks if needed
        mutateOreToItemstack(obj_input)
      })
    }
  })

  // Make indexes unique and remove
  var uniqRemIndexes = [...new Set(remIndexes)]
  for (var i = uniqRemIndexes.length - 1; i >= 0; i--)
    jec_groups.Default.splice(uniqRemIndexes[i], 1)

  return jec_groups
}