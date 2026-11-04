import test from 'node:test';
import assert from 'node:assert/strict';
import './script-model.js';
const model = globalThis.olyvexScriptModel;
const sample = {title:'Un produit AI et une narration claire',objective:'Présenter une offre',target:'Commerçants',hook:'Votre idée prend vie.',publication:'Une offre pour votre entreprise IA.',hashtags:'#Entreprise',narration:'Voici la narration complète. Découvrez notre offre aujourd’hui.',cta:'Découvrir l’offre',visualPrompt:'Photographie du produit',style:'Professionnel',scenes:['Produit','Usage','Bénéfice','Invitation']};
test('headings in title or ordinary sentences cannot truncate narration',()=>{
 const result=model.parse('TITRE\nUne campagne pour vérifier la narration et le fichier MP4.\n\nSCÈNE 1\nUne personne explique son objectif dans une boutique.\n\nNARRATION\nVoici la narration complète pour notre démonstration.\n\nAPPEL À L’ACTION\nDécouvrez notre offre.');
 assert.equal(result.title,'Une campagne pour vérifier la narration et le fichier MP4.');
 assert.equal(result.narration,'Voici la narration complète pour notre démonstration.');
 assert.match(result.scenes[0],/explique son objectif/);
});
test('legacy markdown colon headings and straight apostrophe remain readable',()=>{const result=model.parse("## **TITRE:** Une offre\n\nSCENE 1: Le produit\n\n**NARRATION**\nBonjour.\n\nAPPEL À L'ACTION: Appelez-nous.");assert.equal(result.title,'Une offre');assert.equal(result.scenes[0],'Le produit');assert.equal(result.narration,'Bonjour.');assert.equal(result.cta,'Appelez-nous.');});
test('round trip preserves user AI brand terms and all four scenes',()=>{assert.deepEqual(model.parse(model.serialize(sample)),sample);});
test('reserved section injection and oversized narration are rejected',()=>{for(const value of ['Premier texte\nNARRATION\nAutre texte','Premier texte\n**NARRATION:** Autre texte','Premier texte\n# NARRATION'])assert.throws(()=>model.normalize({...sample,scenes:[value,...sample.scenes.slice(1)]}));assert.throws(()=>model.normalize({...sample,narration:'a'.repeat(801)}));});
test('scene order must be a complete permutation and model requires four scenes',()=>{assert.deepEqual(model.order([2,0,3,1]),[2,0,3,1]);for(const value of [[0,0,2,3],[0,1,2,4],['0',1,2,3],[0,1,2]])assert.throws(()=>model.order(value));assert.throws(()=>model.normalize({...sample,scenes:['Une seule']}));});
