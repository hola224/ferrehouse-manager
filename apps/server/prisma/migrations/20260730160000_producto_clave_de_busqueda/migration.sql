-- Clave de búsqueda normalizada (tarea 1.5).
--
-- SQLite compara texto ignorando mayúsculas solo en ASCII: "Ñ" y "ñ" son
-- letras distintas para su LIKE, y las tildes no se ignoran nunca. Sin esta
-- columna, buscar "cañeria" no encuentra "Cañería" y buscar "CAÑERIA" tampoco.
-- La columna guarda nombre + SKU + códigos en minúsculas y sin tildes, y se
-- escribe en la misma transacción que el producto.
ALTER TABLE "Product" ADD COLUMN "searchKey" TEXT NOT NULL DEFAULT '';

CREATE INDEX "Product_searchKey_idx" ON "Product"("searchKey");
