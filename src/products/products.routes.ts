import { Router } from 'express';
import { NotFoundError } from '../errors';
import { validateParams } from '../middleware/validate';
import { productIdParamSchema } from '../schemas';
import { ProductsService } from './products.service';

export function createProductsRouter(productsService: ProductsService) {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      res.json(await productsService.findAll());
    } catch (err) {
      next(err);
    }
  });

  router.get(
    '/:id',
    validateParams(productIdParamSchema),
    async (req, res, next) => {
      try {
        const product = await productsService.findOne(String(req.params.id));
        if (!product) {
          throw new NotFoundError('Product not found');
        }
        res.json(product);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
