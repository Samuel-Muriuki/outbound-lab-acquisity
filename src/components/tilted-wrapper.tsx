"use client";

import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * 3D tilt-on-hover wrapper. Adapted from
 * https://www.reactbits.dev/components/tilted-card (David Haz / reactbits, MIT).
 *
 * The reactbits original is image-centric and assumes a single <img> as
 * the body. The recent-runs cards on this site are text-only domain
 * cards, so this wrapper drops the image / figcaption / mobile-warning
 * pieces and exposes just the tilt interaction over arbitrary children.
 *
 * Mobile (≤640px): the tilt is suppressed via media query at the
 * call-site (use `hidden sm:block`) — touch devices don't have a
 * real cursor for the effect to track.
 */

const SPRING = {
  damping: 30,
  stiffness: 100,
  mass: 2,
};

interface TiltedWrapperProps {
  children: ReactNode;
  /** Maximum tilt in degrees on each axis. */
  rotateAmplitude?: number;
  /** Scale factor when hovered. 1 = no scale. */
  scaleOnHover?: number;
  /** Forwarded class on the perspective container. */
  className?: string;
  /** Forwarded class on the inner motion div (where the tilt lives). */
  innerClassName?: string;
}

export function TiltedWrapper({
  children,
  rotateAmplitude = 8,
  scaleOnHover = 1.03,
  className,
  innerClassName,
}: TiltedWrapperProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rotateX = useSpring(useMotionValue(0), SPRING);
  const rotateY = useSpring(useMotionValue(0), SPRING);
  const scale = useSpring(1, SPRING);

  function handleMouse(e: React.MouseEvent<HTMLDivElement>) {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const offsetX = e.clientX - rect.left - rect.width / 2;
    const offsetY = e.clientY - rect.top - rect.height / 2;
    const rotationX = (offsetY / (rect.height / 2)) * -rotateAmplitude;
    const rotationY = (offsetX / (rect.width / 2)) * rotateAmplitude;
    rotateX.set(rotationX);
    rotateY.set(rotationY);
  }

  function handleEnter() {
    scale.set(scaleOnHover);
  }

  function handleLeave() {
    rotateX.set(0);
    rotateY.set(0);
    scale.set(1);
  }

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      style={{ perspective: "800px" }}
      onMouseMove={handleMouse}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <motion.div
        className={cn("relative", innerClassName)}
        style={{
          transformStyle: "preserve-3d",
          rotateX,
          rotateY,
          scale,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
