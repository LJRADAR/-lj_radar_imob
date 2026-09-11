import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalSourceKey,
  filterQualifiedRows,
  isCoreOperationalLocation,
  isDemandOnlyPost,
  isObviousProfessionalAdvertiser,
  isPropertyRelevant,
  isUnavailableContent,
  professionalAdvertiserReason,
  sourceUrlAllowed,
} from '../src/quality.js';

test('sourceUrlAllowed enforces the expected platform domain', () => {
  assert.equal(sourceUrlAllowed('https://www.olx.com.br/imovel/abc', 'olx'), true);
  assert.equal(sourceUrlAllowed('https://sp.olx.com.br/imovel/abc', 'olx'), true);
  assert.equal(sourceUrlAllowed('https://evil.example/redirect?to=olx.com.br', 'olx'), false);
  assert.equal(sourceUrlAllowed('file:///etc/passwd', 'olx'), false);
  assert.equal(sourceUrlAllowed('https://www.instagram.com/p/ABC/', 'instagram'), true);
  assert.equal(sourceUrlAllowed('https://www.facebook.com/groups/1/posts/2', 'facebook'), true);
  assert.equal(sourceUrlAllowed('https://t.me/example/123', 'telegram'), true);
  assert.equal(sourceUrlAllowed('https://www.threads.net/@user/post/ABC', 'threads'), true);
});

test('professional seller types and names are rejected', () => {
  assert.equal(isObviousProfessionalAdvertiser({ seller_type: 'business' }), true);
  assert.equal(isObviousProfessionalAdvertiser({ seller_nickname: 'ABC Imóveis' }), true);
  assert.equal(isObviousProfessionalAdvertiser({ seller_nickname: 'João', description: 'CRECI 12345-F' }), true);
  assert.equal(isObviousProfessionalAdvertiser({ seller_nickname: 'Maria', description: 'Vendo meu apartamento direto.' }), false);
});

test('professional advertiser diagnostics identify the first decisive signal', () => {
  assert.equal(professionalAdvertiserReason({ seller_type: 'business', seller_nickname: 'Maria' }), 'seller_type');
  assert.equal(professionalAdvertiserReason({ seller_nickname: 'ABC Imóveis' }), 'seller_name');
  assert.equal(professionalAdvertiserReason({ seller_nickname: 'João', description: 'CRECI 12345-F' }), 'description');
  assert.equal(professionalAdvertiserReason({ seller_nickname: 'Maria', description: 'Vendo meu apartamento direto.' }), null);
});

test('group-like title does not by itself classify the advertiser as professional', () => {
  assert.equal(isObviousProfessionalAdvertiser({
    seller_nickname: null,
    seller_type: null,
    title: 'Imóveis para venda em Santo André | apartamento direto com proprietário',
    description: 'Apartamento direto com proprietário, 2 dormitórios.',
  }), false);
});

test('filterQualifiedRows rejects wrong domains and explains professional evidence', () => {
  const rows = [
    { source_url: 'https://www.olx.com.br/imovel/1', seller_nickname: 'Maria' },
    { source_url: 'https://www.olx.com.br/imovel/2', seller_type: 'professional' },
    { source_url: 'https://www.olx.com.br/imovel/3', seller_nickname: 'ABC Imóveis' },
    { source_url: 'https://www.olx.com.br/imovel/4', seller_nickname: 'João', description: 'CRECI 12345-F' },
    { source_url: 'https://example.com/imovel/5', seller_nickname: 'João' },
  ];
  const result = filterQualifiedRows(rows, 'olx');
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected_count, 4);
  assert.deepEqual(result.rejection_reasons, {
    wrong_domain: 1,
    unavailable_content: 0,
    non_property: 0,
    outside_core_area: 0,
    demand_post: 0,
    professional_advertiser: 3,
    professional_seller_type: 1,
    professional_seller_name: 1,
    professional_description: 1,
  });
});

test('canonicalSourceKey removes tracking noise but preserves identifying query params', () => {
  assert.equal(
    canonicalSourceKey('https://www.facebook.com/groups/1/posts/2/?utm_source=x&story_fbid=9#fragment'),
    'https://www.facebook.com/groups/1/posts/2?story_fbid=9',
  );
});

test('facebook quality rejects unavailable, non-property, outside-area and demand-only posts', () => {
  const rows = [
    {
      source_url: 'https://www.facebook.com/groups/1/posts/1',
      title: "This content isn't available right now",
      city: 'Santo André',
    },
    {
      source_url: 'https://www.facebook.com/groups/1/posts/2',
      title: '2026 Volkswagen Polo',
      description: 'carro completo, tabela FIPE',
      city: 'Santo André',
    },
    {
      source_url: 'https://www.facebook.com/groups/1/posts/3',
      title: '3 beds · 2 bath · House',
      description: 'Casa com piscina e garagem',
      city: 'Itanhaém',
    },
    {
      source_url: 'https://www.facebook.com/groups/1/posts/4',
      title: 'Procuro apartamento',
      description: 'Quero comprar apartamento em Diadema',
      city: 'Diadema',
    },
    {
      source_url: 'https://www.facebook.com/groups/1/posts/5',
      title: 'Apartamento direto com proprietário',
      description: 'Vendo apartamento 2 dormitórios em Santo André',
      city: 'Santo André',
      seller_nickname: 'Maria',
    },
  ];
  const result = filterQualifiedRows(rows, 'facebook');
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].source_url.endsWith('/5'), true);
  assert.equal(result.rejected_count, 4);
  assert.equal(result.rejection_reasons.unavailable_content, 1);
  assert.equal(result.rejection_reasons.non_property, 1);
  assert.equal(result.rejection_reasons.outside_core_area, 1);
  assert.equal(result.rejection_reasons.demand_post, 1);
});

test('facebook quality helper diagnostics classify pilot examples', () => {
  assert.equal(isUnavailableContent({ title: "This content isn't available right now" }), true);
  assert.equal(isPropertyRelevant({ title: 'Bebê Reborn Silicone', description: 'boneca realista' }), false);
  assert.equal(isPropertyRelevant({ title: '3 beds · 2 bath · House' }), true);
  assert.equal(isCoreOperationalLocation({ city: 'Diadema' }), true);
  assert.equal(isCoreOperationalLocation({ city: 'Osasco' }), false);
  assert.equal(isDemandOnlyPost({ title: 'Procuro casa para comprar em Santo André' }), true);
  assert.equal(isDemandOnlyPost({ title: 'Vendo minha casa em Santo André' }), false);
});
