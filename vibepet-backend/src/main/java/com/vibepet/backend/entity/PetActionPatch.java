package com.vibepet.backend.entity;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "pet_action_patch")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PetActionPatch {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "pet_id", nullable = false, length = 64)
    private String petId;

    @Column(name = "action_type", nullable = false, length = 32)
    private String actionType;

    @Column(name = "title", nullable = false, length = 64)
    private String title;

    @Column(name = "image_url", nullable = false, length = 255)
    private String imageUrl;

    @Column(name = "frames_count", nullable = false)
    private Integer framesCount;

    @Column(name = "frame_duration", nullable = false)
    private Integer frameDuration;

    @Column(name = "prompt_used", columnDefinition = "TEXT")
    private String promptUsed;

    @Column(name = "ref_image_url", length = 255)
    private String refImageUrl;

    @Column(name = "downloads_count", nullable = false)
    private Integer downloadsCount;

    @Column(name = "likes_count", nullable = false)
    private Integer likesCount;

    @Column(name = "status", nullable = false)
    private Integer status; // 1:公开, 0:下架/审核中

    @Column(name = "created_time", nullable = false, updatable = false)
    private LocalDateTime createdTime;

    @PrePersist
    protected void onCreate() {
        createdTime = LocalDateTime.now();
        if (framesCount == null) framesCount = 8;
        if (frameDuration == null) frameDuration = 120;
        if (downloadsCount == null) downloadsCount = 0;
        if (likesCount == null) likesCount = 0;
        if (status == null) status = 1;
        if (refImageUrl == null) refImageUrl = "";
    }
}
