package com.veiltalk.video;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

public interface VideoRepository extends JpaRepository<Video, UUID> {
}
