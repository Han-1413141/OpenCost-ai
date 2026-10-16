import test from 'node:test';
import assert from 'node:assert/strict';
import { personaCarouselGroup, personaCarouselPages } from '../web/VBTIPersonaCarousel.js';
import { personaCatalog } from '../shared/feedback-persona.js';
test('Carousel covers all 32 roles, keeps three distinct cards, and wraps both ways', () => {
 const groups=Array.from({length:personaCarouselPages},(_,page)=>personaCarouselGroup(page));
 assert.equal(new Set(groups.flat()).size,personaCatalog.length);
 for(const group of groups){assert.equal(group.length,3);assert.equal(new Set(group).size,3);for(const index of group)assert.ok(personaCatalog[index]);}
 assert.deepEqual(personaCarouselGroup(-1),groups.at(-1));
 assert.deepEqual(personaCarouselGroup(personaCarouselPages),groups[0]);
});
