-- El ancho del papel (en columnas de texto) es una propiedad de la impresora,
-- y la impresora es de la estación. 32 = papel de 58 mm, 48 = papel de 80 mm.
-- El default 32 conserva el comportamiento que ya tenían las estaciones.
ALTER TABLE "Station" ADD COLUMN "printerWidth" INTEGER NOT NULL DEFAULT 32;
