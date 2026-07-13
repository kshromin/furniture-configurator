// Барель-реэкспорт: файл разросся до ~1050 строк (геометрия+коллизии/драг+хелперы размеров/цены
// вперемешку) и стал тяжело читать/грепать точечно — разбит на модули по смыслу, этот файл
// оставлен только чтобы не переписывать импорты в потребителях (wardrobe.js, tabs.js,
// itemDrag.js, dimensions.js, presets.js, wardrobe-swing.js, wardrobe-open.js, sliding-doors.js).
// Для новой работы читайте/правьте конкретный модуль напрямую, а не этот файл:
//   wardrobe-constants.js — константы, общие для 2+ модулей ниже (во избежание циклических импортов)
//   wardrobe-sizing.js    — сколько места доступно (ширина секций, глубина ящика/сетки/вешала/корзины)
//   wardrobe-items.js     — коллизии/драг: где стоит и куда можно переставить элемент секции
//   wardrobe-geometry.js  — собственно 3D-геометрия (buildWardrobeBox) поверх данных двух выше
export * from './wardrobe-constants.js';
export * from './wardrobe-sizing.js';
export * from './wardrobe-items.js';
export * from './wardrobe-geometry.js';
