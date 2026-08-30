# Flujo de desarrollo Balo

## Ramas

- `main` contiene únicamente versiones aprobadas para producción.
- `dev` integra el siguiente conjunto de cambios validado.
- Todo trabajo nace desde `dev` en una rama `feature/<nombre>`.
- Una feature entra en `dev` solo mediante pull request.
- `dev` entra en `main` solo mediante pull request de promoción.
- El método de integración es **rebase merge**. No se permiten pushes ni merges
  directos a `dev` o `main`.

## Antes del pull request

1. Sincronizar la rama con `dev` sin crear commits de merge.
2. Ejecutar `npm run verify` y `npm run test:e2e`.
3. Confirmar que no se incluyen secretos, medios privados ni datos personales.
4. Documentar límites de validación y cualquier activación externa pendiente.

Los despliegues de código requieren aprobación de Orlando. Una publicación de
contenido desde el CMS es una acción administrativa auditada y no modifica el
historial Git.
