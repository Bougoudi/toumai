import { Router } from 'express';
import { asyncHandler } from '../../middleware/validate.js';
import { discoveryController } from './discovery.controller.js';

// Recherche de produits (texte / photo / code-barres)
export const discoveryRouter = Router();
discoveryRouter.get('/search/text', discoveryController.searchText);
discoveryRouter.post('/search/photo', asyncHandler(discoveryController.searchPhoto));
discoveryRouter.get('/search/barcode/:code', discoveryController.searchBarcode);

// Favoris
export const favoriteRouter = Router();
favoriteRouter.get('/', asyncHandler(discoveryController.listFavorites));
favoriteRouter.post('/', asyncHandler(discoveryController.addFavorite));
favoriteRouter.delete('/:id', asyncHandler(discoveryController.removeFavorite));
favoriteRouter.post('/:id/source', asyncHandler(discoveryController.source));
favoriteRouter.post('/:id/publish/:channelId', asyncHandler(discoveryController.publish));
