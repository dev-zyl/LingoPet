package com.vibepet.backend.repository;

import com.vibepet.backend.entity.PetActionPatch;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public interface PetActionPatchRepository extends JpaRepository<PetActionPatch, Long> {

    /**
     * 分页查询特定宠物和特定动作类型下的公开动作切片
     * @param petId 宠物ID
     * @param actionType 动作类型
     * @param status 状态 (1:公开)
     * @param pageable 分页与排序参数 (可以传入 CreatedTime / LikesCount 等排序)
     * @return 分页列表
     */
    Page<PetActionPatch> findByPetIdAndActionTypeAndStatus(String petId, String actionType, Integer status, Pageable pageable);

    /**
     * 高效更新点赞数 (直接由定时任务调用，减少行级锁冲突)
     * @param id 动作ID
     * @param increment 增量
     * @return 影响行数
     */
    @Modifying
    @Transactional
    @Query("UPDATE PetActionPatch p SET p.likesCount = p.likesCount + :increment WHERE p.id = :id")
    int incrementLikesCount(@Param("id") Long id, @Param("increment") Integer increment);

    /**
     * 高效更新下载数 (直接由定时任务调用)
     * @param id 动作ID
     * @param increment 增量
     * @return 影响行数
     */
    @Modifying
    @Transactional
    @Query("UPDATE PetActionPatch p SET p.downloadsCount = p.downloadsCount + :increment WHERE p.id = :id")
    int incrementDownloadsCount(@Param("id") Long id, @Param("increment") Integer increment);
}
