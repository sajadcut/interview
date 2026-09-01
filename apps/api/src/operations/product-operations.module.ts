import { Module } from "@nestjs/common";
import { ProductOperationsController } from "./product-operations.controller";
import { ProductOperationsService } from "./product-operations.service";

@Module({
  controllers: [ProductOperationsController],
  providers: [ProductOperationsService],
  exports: [ProductOperationsService],
})
export class ProductOperationsModule {}
