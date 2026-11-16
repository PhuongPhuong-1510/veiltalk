package com.veiltalk.avatar;

import java.time.Instant;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

@Component
public class AvatarPortraitCleanupWorker {
	private static final Logger LOGGER = LoggerFactory.getLogger(AvatarPortraitCleanupWorker.class);
	private final AvatarPortraitCleanupJobRepository repository;
	private final AvatarProfileRepository profiles;
	private final AvatarPortraitStorage storage;
	private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor(r -> {
		Thread thread = new Thread(r, "avatar-portrait-cleanup"); thread.setDaemon(true); return thread;
	});

	public AvatarPortraitCleanupWorker(AvatarPortraitCleanupJobRepository repository,
			AvatarProfileRepository profiles, AvatarPortraitStorage storage) {
		this.repository = repository; this.profiles = profiles; this.storage = storage;
	}

	@PostConstruct void start() { executor.scheduleWithFixedDelay(this::runSafely, 60, 60, TimeUnit.SECONDS); }
	@PreDestroy void stop() { executor.shutdownNow(); }

	void runSafely() {
		try {
			for (var job : repository.findDue(Instant.now())) {
				if (profiles.existsByPortraitObjectKey(job.getObjectKey())) { repository.delete(job); continue; }
				try { storage.remove(job.getObjectKey()); repository.delete(job); }
				catch (RuntimeException exception) {
					int attempts = job.getAttempts() + 1;
					job.setAttempts(attempts);
					job.setLastError(truncate(exception.getMessage()));
					job.setNextAttemptAt(Instant.now().plusSeconds(Math.min(3600, 60L << Math.min(attempts, 5))));
					repository.save(job);
				}
			}
		} catch (RuntimeException exception) { LOGGER.warn("Avatar portrait cleanup scan failed", exception); }
	}

	private String truncate(String value) { return value == null ? null : value.substring(0, Math.min(1000, value.length())); }
}
