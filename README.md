# WebGPU Cloth Simulation

Интерактивная симуляция ткани на Position Based Dynamics (PBD).  
Основной путь — WebGPU compute, fallback — CPU + WebGL2.

## Overview

Сетка частиц с distance-constraints. Центральная вершина кинематическая  (`z = A · sin(2πft)`), углы закреплены. Волны расходятся от центра к границам.  Фиксированный шаг `dt = 1/60`. UI позволяет менять амплитуду, частоту,  число итераций солвера и включать гравитацию.

## Features

- WebGPU compute (Jacobi PBD) / CPU fallback
- Structural + shear + bending constraints
- Кинематический центр + фиксированные углы
- Fixed timestep, независимо от FPS
- Орбитальная камера (drag / wheel / pinch)

## Architecture

```
mountCloth(canvas, params)
  → выбирает backend (WebGPU → WebGL2/CPU)
  → создаёт ClothController
  → RAF-цикл: predict → solve (N итераций) → update velocities → render
```

Параметры и статистика доступны через `controller.params` / `getStats()`.

## Simulation model

- **Particles** — позиции + предыдущие позиции (для velocity)
- **Structural / shear / bending** — distance constraints с rest-length
- **Fixed vertices** (углы) и **kinematic** (центр) имеют `w = 0`  
  → солвер их не двигает; центр каждый кадр перезаписывается

## GPU implementation

- Один particle buffer на GPU
- Compute pipeline: predict → constraint solve (Jacobi)
- Поправки копятся атомарными `i32`, затем усредняются  (нет race conditions при записи в одну вершину)
- Render — отдельный pass (points / lines / triangles)

## Fixed timestep

Semi-implicit Euler + позиционная проекция.  
`dt` фиксирован, аккумулятор не привязан к `requestAnimationFrame`.

## CPU / WebGL2 fallback

Если `navigator.gpu` недоступен — тот же Jacobi PBD на CPU,  отрисовка через WebGL2. Поведение и API контроллера идентичны.

## Controls

| Действие              | Эффект                    |
|-----------------------|---------------------------|
| Амплитуда / Частота   | кинематика центра         |
| Итерации              | жёсткость / стабильность  |
| Гравитация            | доп. сила вниз            |
| Пауза / Сброс         | —                         |

## References

- Müller et al. — Position Based Dynamics
- Bridson, Fedkiw, Anderson — Robust Treatment of Collisions, Contact and Friction for Cloth Animation
- XPBD (Macklin et al.)