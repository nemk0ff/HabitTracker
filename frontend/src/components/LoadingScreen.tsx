import { motion } from 'framer-motion';

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-full">
      <motion.div
        className="flex gap-1.5"
        initial="start"
        animate="end"
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-3 h-3 rounded-full bg-tg-button"
            animate={{
              scale: [1, 1.4, 1],
              opacity: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              delay: i * 0.15,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}
